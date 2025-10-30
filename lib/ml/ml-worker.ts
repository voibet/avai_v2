import { spawn } from 'child_process';
import { join } from 'path';
import { setTrainingFlag } from './ml-cache';

/**
 * Generic function to spawn ML task in separate process
 */
function spawnMLProcess(mode: string, data: any, onComplete?: () => void): void {
  const scriptPath = join(process.cwd(), 'lib', 'ml', 'ml-background-process.ts');
  
  const child = spawn('npx', ['tsx', scriptPath], {
    stdio: ['pipe', 'inherit', 'inherit'],
    shell: true
  });

  const inputData = JSON.stringify({ mode, ...data });
  child.stdin.write(inputData);
  child.stdin.end();

  child.on('error', (error) => {
    console.error(`[Main] Failed to spawn ${mode} process:`, error);
    if (onComplete) onComplete();
  });

  child.on('exit', (code) => {
    console.log(`[Main] ${mode} process exited with code ${code}`);
    if (onComplete) onComplete();
  });
}

/**
 * Starts training in a separate Node.js process (non-blocking)
 */
export function startTrainingWorker(
  trainingData: any[],
  predictionData: any[],
  features: string[]
): void {
  console.log('[Main] Spawning separate process for training...');
  spawnMLProcess('train', { trainingData, predictionData, features }, () => {
    // Clear training flag when process completes
    setTrainingFlag(false);
    console.log('[Main] Training flag cleared');
  });
  console.log('[Main] Training process spawned. Check console for progress.');
}

