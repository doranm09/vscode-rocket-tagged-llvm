import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';
import { spawn } from 'child_process';

interface BuildOutputs {
  asmPath: string;
  objPath: string;
}

interface SidebandOutputs {
  sidebandBinPath: string;
  sidebandHexPath: string;
  sidebandJsonPath: string;
  sidebandWords: number[];
}

interface LinkOutputs {
  elfPath: string;
  linkerPath: string;
}

interface BundleOutputs {
  bundleDirPath: string;
  bundleManifestPath: string;
  bundleZipPath?: string;
}

interface ProcessResult {
  stdout: string;
  stderr: string;
}

function expandWorkspaceVar(value: string, workspaceFolder: vscode.WorkspaceFolder): string {
  return value.replace('${workspaceFolder}', workspaceFolder.uri.fsPath);
}

function getActiveFile(): vscode.Uri {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    throw new Error('No active editor. Open a C or .tagc file first.');
  }
  return editor.document.uri;
}

function runProcess(cmd: string, args: string[], cwd: string): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${cmd} failed (${code})\n${stdout}\n${stderr}`));
      }
    });
  });
}

function ensureWorkspaceFolder(fileUri: vscode.Uri): vscode.WorkspaceFolder {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
  if (!workspaceFolder) {
    throw new Error('Active file must be inside a workspace folder.');
  }
  return workspaceFolder;
}

function resolveConfig() {
  const cfg = vscode.workspace.getConfiguration('rocketTagged');
  return {
    llvmBinDir: cfg.get<string>('llvmBinDir', '/usr/bin'),
    objcopyPath: cfg.get<string>('objcopyPath', 'riscv64-unknown-elf-objcopy'),
    sidebandSection: cfg.get<string>('sidebandSection', '.fsm_trace'),
    python: cfg.get<string>('python', 'python3'),
    targetTriple: cfg.get<string>('targetTriple', 'riscv64-unknown-elf'),
    riscvArch: cfg.get<string>('riscvArch', 'rv64gc_zicsr_zifencei'),
    riscvAbi: cfg.get<string>('riscvAbi', 'lp64d'),
    outputDir: cfg.get<string>('outputDir', '${workspaceFolder}/build/tagged'),
    passPluginPath: cfg.get<string>('passPluginPath', ''),
    extraClangArgs: cfg.get<string[]>('extraClangArgs', []),
    fsmPolicyPath: cfg.get<string>('fsmPolicyPath', '${workspaceFolder}/fsm-policy.json'),
    linkerPath: cfg.get<string>('linkerPath', ''),
    linkArgs: cfg.get<string[]>('linkArgs', ['-nostdlib', '-Wl,-e,main', '-Wl,-Ttext=0x80000000']),
    bundleOutputDir: cfg.get<string>('bundleOutputDir', '${workspaceFolder}/build/tagged/deploy'),
    bundleCreateZip: cfg.get<boolean>('bundleCreateZip', true),
    payloadLoadAddress: cfg.get<string>('payloadLoadAddress', '0x80000000'),
    sidebandLoadAddress: cfg.get<string>('sidebandLoadAddress', '0x88000000')
  };
}

function resolvePolicyPath(context: vscode.ExtensionContext, workspaceFolder: vscode.WorkspaceFolder, cfg: ReturnType<typeof resolveConfig>): string {
  const policyPath = expandWorkspaceVar(cfg.fsmPolicyPath, workspaceFolder);
  const defaultPolicy = path.join(context.extensionPath, 'runtime', 'default-fsm-policy.json');
  return fs.existsSync(policyPath) ? policyPath : defaultPolicy;
}

function sha256OfFile(filePath: string): string {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

async function buildCurrentFile(): Promise<BuildOutputs> {
  const fileUri = getActiveFile();
  const filePath = fileUri.fsPath;
  const workspaceFolder = ensureWorkspaceFolder(fileUri);

  const cfg = resolveConfig();
  const clangPath = path.join(cfg.llvmBinDir, 'clang');
  const outDir = expandWorkspaceVar(cfg.outputDir, workspaceFolder);
  const baseName = path.parse(filePath).name;
  const asmPath = path.join(outDir, `${baseName}.tagged.s`);
  const objPath = path.join(outDir, `${baseName}.o`);

  fs.mkdirSync(outDir, { recursive: true });

  const commonArgs = [
    '-target', cfg.targetTriple,
    '-march=' + cfg.riscvArch,
    '-mabi=' + cfg.riscvAbi,
    '-ffreestanding',
    '-fno-builtin',
    '-O2',
    '-g',
    filePath
  ];

  if (cfg.passPluginPath.trim().length > 0) {
    commonArgs.push('-fpass-plugin=' + cfg.passPluginPath.trim());
  }

  commonArgs.push(...cfg.extraClangArgs);

  await runProcess(clangPath, [...commonArgs, '-S', '-o', asmPath], workspaceFolder.uri.fsPath);
  await runProcess(clangPath, [...commonArgs, '-c', '-o', objPath], workspaceFolder.uri.fsPath);

  return { asmPath, objPath };
}

async function extractSidebandFromObject(objPath: string): Promise<SidebandOutputs> {
  const fileUri = getActiveFile();
  const workspaceFolder = ensureWorkspaceFolder(fileUri);
  const cfg = resolveConfig();

  const outBase = objPath.replace(/\.o$/, '');
  const sidebandBinPath = `${outBase}.fsm_trace.bin`;
  const sidebandHexPath = `${outBase}.fsm_trace.hex`;
  const sidebandJsonPath = `${outBase}.fsm_trace.json`;

  await runProcess(
    cfg.objcopyPath,
    [`--dump-section`, `${cfg.sidebandSection}=${sidebandBinPath}`, objPath],
    workspaceFolder.uri.fsPath
  );

  if (!fs.existsSync(sidebandBinPath)) {
    throw new Error(`Sideband extraction failed: ${sidebandBinPath} was not created.`);
  }

  const raw = fs.readFileSync(sidebandBinPath);
  if (raw.length % 4 !== 0) {
    throw new Error(`Extracted sideband length (${raw.length}) is not 4-byte aligned.`);
  }

  const words: number[] = [];
  for (let i = 0; i < raw.length; i += 4) {
    words.push(raw.readUInt32LE(i));
  }

  const hexLines = words.map((w) => '0x' + w.toString(16).padStart(8, '0'));
  fs.writeFileSync(sidebandHexPath, hexLines.join('\n') + (hexLines.length > 0 ? '\n' : ''));

  const manifest = {
    section: cfg.sidebandSection,
    sourceObject: objPath,
    sidebandBin: sidebandBinPath,
    wordCount: words.length,
    words,
    hexWords: hexLines
  };
  fs.writeFileSync(sidebandJsonPath, JSON.stringify(manifest, null, 2) + '\n');

  return {
    sidebandBinPath,
    sidebandHexPath,
    sidebandJsonPath,
    sidebandWords: words
  };
}

async function linkObjectToElf(objPath: string): Promise<LinkOutputs> {
  const fileUri = getActiveFile();
  const workspaceFolder = ensureWorkspaceFolder(fileUri);
  const cfg = resolveConfig();

  const outBase = objPath.replace(/\.o$/, '');
  const elfPath = `${outBase}.elf`;

  const linkerPath = cfg.linkerPath.trim().length > 0
    ? cfg.linkerPath.trim()
    : path.join(cfg.llvmBinDir, 'clang');

  const linkerBase = path.basename(linkerPath);
  const args: string[] = [];

  if (linkerBase.includes('clang')) {
    args.push('-target', cfg.targetTriple, '-march=' + cfg.riscvArch, '-mabi=' + cfg.riscvAbi);
  }

  args.push(objPath, ...cfg.linkArgs, '-o', elfPath);
  await runProcess(linkerPath, args, workspaceFolder.uri.fsPath);

  return { elfPath, linkerPath };
}

async function checkAsmWithFsm(context: vscode.ExtensionContext, asmPath: string): Promise<void> {
  const fileUri = getActiveFile();
  const workspaceFolder = ensureWorkspaceFolder(fileUri);
  const cfg = resolveConfig();

  const checkerScript = path.join(context.extensionPath, 'runtime', 'fsm-check.py');
  const selectedPolicy = resolvePolicyPath(context, workspaceFolder, cfg);

  await runProcess(
    cfg.python,
    [checkerScript, '--asm', asmPath, '--policy', selectedPolicy],
    workspaceFolder.uri.fsPath
  );
}

async function checkSidebandWithFsm(context: vscode.ExtensionContext, sidebandBinPath: string): Promise<void> {
  const fileUri = getActiveFile();
  const workspaceFolder = ensureWorkspaceFolder(fileUri);
  const cfg = resolveConfig();

  const checkerScript = path.join(context.extensionPath, 'runtime', 'fsm-check.py');
  const selectedPolicy = resolvePolicyPath(context, workspaceFolder, cfg);

  await runProcess(
    cfg.python,
    [checkerScript, '--sideband-bin', sidebandBinPath, '--policy', selectedPolicy],
    workspaceFolder.uri.fsPath
  );
}

async function packageDeploymentBundle(
  context: vscode.ExtensionContext,
  build: BuildOutputs,
  sideband: SidebandOutputs,
  link: LinkOutputs
): Promise<BundleOutputs> {
  const fileUri = getActiveFile();
  const workspaceFolder = ensureWorkspaceFolder(fileUri);
  const cfg = resolveConfig();

  const baseName = path.parse(fileUri.fsPath).name;
  const bundleRoot = expandWorkspaceVar(cfg.bundleOutputDir, workspaceFolder);
  const bundleDirPath = path.join(bundleRoot, baseName);

  fs.rmSync(bundleDirPath, { recursive: true, force: true });
  fs.mkdirSync(bundleDirPath, { recursive: true });

  const selectedPolicy = resolvePolicyPath(context, workspaceFolder, cfg);

  const filesToCopy = [
    build.asmPath,
    build.objPath,
    link.elfPath,
    sideband.sidebandBinPath,
    sideband.sidebandHexPath,
    sideband.sidebandJsonPath,
    selectedPolicy
  ];

  const bundledFiles: Array<{ name: string; sizeBytes: number; sha256: string }> = [];
  for (const src of filesToCopy) {
    const name = path.basename(src);
    const dest = path.join(bundleDirPath, name);
    fs.copyFileSync(src, dest);
    bundledFiles.push({
      name,
      sizeBytes: fs.statSync(dest).size,
      sha256: sha256OfFile(dest)
    });
  }

  const bundleManifestPath = path.join(bundleDirPath, 'bundle.json');
  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceFile: fileUri.fsPath,
    target: {
      triple: cfg.targetTriple,
      arch: cfg.riscvArch,
      abi: cfg.riscvAbi
    },
    addresses: {
      payloadLoadAddress: cfg.payloadLoadAddress,
      sidebandLoadAddress: cfg.sidebandLoadAddress
    },
    linker: {
      path: link.linkerPath,
      args: cfg.linkArgs
    },
    sideband: {
      section: cfg.sidebandSection,
      wordCount: sideband.sidebandWords.length,
      words: sideband.sidebandWords
    },
    files: bundledFiles
  };
  fs.writeFileSync(bundleManifestPath, JSON.stringify(manifest, null, 2) + '\n');

  let bundleZipPath: string | undefined;
  if (cfg.bundleCreateZip) {
    bundleZipPath = `${bundleDirPath}.zip`;
    const names = fs.readdirSync(bundleDirPath).sort();
    await runProcess(cfg.python, ['-m', 'zipfile', '-c', bundleZipPath, ...names], bundleDirPath);
  }

  return { bundleDirPath, bundleManifestPath, bundleZipPath };
}

export function activate(context: vscode.ExtensionContext): void {
  const buildCmd = vscode.commands.registerCommand('rocketTagged.buildCurrentFile', async () => {
    try {
      const outputs = await buildCurrentFile();
      vscode.window.showInformationMessage(
        `Rocket Tagged build complete: ${outputs.asmPath} and ${outputs.objPath}`
      );
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
    }
  });

  const checkCmd = vscode.commands.registerCommand('rocketTagged.checkCurrentFile', async () => {
    try {
      const outputs = await buildCurrentFile();
      await checkAsmWithFsm(context, outputs.asmPath);
      vscode.window.showInformationMessage('FSM asm-marker check passed.');
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
    }
  });

  const buildAndCheckCmd = vscode.commands.registerCommand('rocketTagged.buildAndCheckCurrentFile', async () => {
    try {
      const outputs = await buildCurrentFile();
      await checkAsmWithFsm(context, outputs.asmPath);
      vscode.window.showInformationMessage(
        `Build + asm-marker FSM check passed for ${path.basename(outputs.asmPath)}`
      );
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
    }
  });

  const buildSidebandCmd = vscode.commands.registerCommand('rocketTagged.buildSidebandCurrentFile', async () => {
    try {
      const outputs = await buildCurrentFile();
      const sideband = await extractSidebandFromObject(outputs.objPath);
      vscode.window.showInformationMessage(
        `FSM sideband generated: ${sideband.sidebandBinPath} (${sideband.sidebandWords.length} tags)`
      );
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
    }
  });

  const checkSidebandCmd = vscode.commands.registerCommand('rocketTagged.checkSidebandCurrentFile', async () => {
    try {
      const outputs = await buildCurrentFile();
      const sideband = await extractSidebandFromObject(outputs.objPath);
      await checkSidebandWithFsm(context, sideband.sidebandBinPath);
      vscode.window.showInformationMessage(
        `Build + sideband FSM check passed (${sideband.sidebandWords.length} tags).`
      );
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
    }
  });

  const packageBundleCmd = vscode.commands.registerCommand('rocketTagged.packageDeploymentCurrentFile', async () => {
    try {
      const outputs = await buildCurrentFile();
      const sideband = await extractSidebandFromObject(outputs.objPath);
      await checkSidebandWithFsm(context, sideband.sidebandBinPath);
      const link = await linkObjectToElf(outputs.objPath);
      const bundle = await packageDeploymentBundle(context, outputs, sideband, link);

      const zipSuffix = bundle.bundleZipPath ? ` and ${bundle.bundleZipPath}` : '';
      vscode.window.showInformationMessage(
        `Deployment bundle ready: ${bundle.bundleDirPath}${zipSuffix}`
      );
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
    }
  });

  context.subscriptions.push(
    buildCmd,
    checkCmd,
    buildAndCheckCmd,
    buildSidebandCmd,
    checkSidebandCmd,
    packageBundleCmd
  );
}

export function deactivate(): void {
  // no-op
}
