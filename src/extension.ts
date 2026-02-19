import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';

interface BuildOutputs {
  asmPath: string;
  objPath: string;
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

function runProcess(cmd: string, args: string[], cwd: string): Promise<void> {
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
        resolve();
      } else {
        reject(new Error(`${cmd} failed (${code})\n${stdout}\n${stderr}`));
      }
    });
  });
}

function resolveConfig() {
  const cfg = vscode.workspace.getConfiguration('rocketTagged');
  return {
    llvmBinDir: cfg.get<string>('llvmBinDir', '/usr/bin'),
    python: cfg.get<string>('python', 'python3'),
    targetTriple: cfg.get<string>('targetTriple', 'riscv64-unknown-elf'),
    riscvArch: cfg.get<string>('riscvArch', 'rv64gc_zicsr_zifencei'),
    riscvAbi: cfg.get<string>('riscvAbi', 'lp64d'),
    outputDir: cfg.get<string>('outputDir', '${workspaceFolder}/build/tagged'),
    passPluginPath: cfg.get<string>('passPluginPath', ''),
    extraClangArgs: cfg.get<string[]>('extraClangArgs', []),
    fsmPolicyPath: cfg.get<string>('fsmPolicyPath', '${workspaceFolder}/fsm-policy.json')
  };
}

async function buildCurrentFile(context: vscode.ExtensionContext): Promise<BuildOutputs> {
  const fileUri = getActiveFile();
  const filePath = fileUri.fsPath;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
  if (!workspaceFolder) {
    throw new Error('Active file must be inside a workspace folder.');
  }

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

async function checkAsmWithFsm(context: vscode.ExtensionContext, asmPath: string): Promise<void> {
  const fileUri = getActiveFile();
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
  if (!workspaceFolder) {
    throw new Error('Active file must be inside a workspace folder.');
  }

  const cfg = resolveConfig();
  const checkerScript = path.join(context.extensionPath, 'runtime', 'fsm-check.py');
  const policyPath = expandWorkspaceVar(cfg.fsmPolicyPath, workspaceFolder);

  const defaultPolicy = path.join(context.extensionPath, 'runtime', 'default-fsm-policy.json');
  const selectedPolicy = fs.existsSync(policyPath) ? policyPath : defaultPolicy;

  await runProcess(
    cfg.python,
    [checkerScript, '--asm', asmPath, '--policy', selectedPolicy],
    workspaceFolder.uri.fsPath
  );
}

export function activate(context: vscode.ExtensionContext): void {
  const buildCmd = vscode.commands.registerCommand('rocketTagged.buildCurrentFile', async () => {
    try {
      const outputs = await buildCurrentFile(context);
      vscode.window.showInformationMessage(
        `Rocket Tagged build complete: ${outputs.asmPath} and ${outputs.objPath}`
      );
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
    }
  });

  const checkCmd = vscode.commands.registerCommand('rocketTagged.checkCurrentFile', async () => {
    try {
      const outputs = await buildCurrentFile(context);
      await checkAsmWithFsm(context, outputs.asmPath);
      vscode.window.showInformationMessage('FSM check passed.');
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
    }
  });

  const buildAndCheckCmd = vscode.commands.registerCommand('rocketTagged.buildAndCheckCurrentFile', async () => {
    try {
      const outputs = await buildCurrentFile(context);
      await checkAsmWithFsm(context, outputs.asmPath);
      vscode.window.showInformationMessage(
        `Build + FSM check passed for ${path.basename(outputs.asmPath)}`
      );
    } catch (err) {
      vscode.window.showErrorMessage(String(err));
    }
  });

  context.subscriptions.push(buildCmd, checkCmd, buildAndCheckCmd);
}

export function deactivate(): void {
  // no-op
}
