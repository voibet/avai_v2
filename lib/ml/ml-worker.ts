import { spawn } from 'child_process';
import { join } from 'path';
import { setTrainingFlag } from './ml-cache';

/**
 * Generic function to spawn ML task in separate process
 */
function spawnMLProcess(mode: string, data: any, onComplete?: (result?: any) => void): void {
  const scriptPath = join(process.cwd(), 'lib', 'ml', 'ml-background-process.ts');

  const child = spawn('npx', ['tsx', scriptPath], {
    stdio: ['pipe', 'pipe', 'inherit'], // Change stdout to pipe to capture output
    shell: true
  });

  const inputData = JSON.stringify({ mode, ...data });
  child.stdin.write(inputData);
  child.stdin.end();

  let stdoutData = '';

  // Capture stdout from child process
  child.stdout?.on('data', (data) => {
    stdoutData += data.toString();
  });

  child.on('error', (error) => {
    console.error(`[Main] Failed to spawn ${mode} process:`, error);
    if (onComplete) onComplete();
  });

  child.on('exit', (code) => {
    console.log(`[Main] ${mode} process exited with code ${code}`);

    let result;
    if (stdoutData.trim()) {
      try {
        result = JSON.parse(stdoutData.trim());
      } catch (e) {
        console.warn(`[Main] Failed to parse ${mode} result:`, e);
      }
    }

    if (onComplete) onComplete(result);
  });
}

/**
 * Generic function to start MLP operations in background
 * @param mode - 'train', 'test', or 'predict'
 * @param data - Data object containing trainingData, predictionData, features, and optional epochs/batchSize
 * @param onComplete - Optional callback when process completes
 */
export function startMLPWorker(
  mode: 'train' | 'test' | 'predict',
  data: {
    trainingData: any[],
    predictionData: any[],
    features: string[],
    epochs?: number,
    batchSize?: number
  },
  onComplete?: (result?: any) => void
): void {
  console.log(`[Main] Spawning separate process for ${mode}...`);

  const processData = {
    mode,
    ...data
  };

  const onProcessComplete = (result?: any) => {
    console.log(`[Main] ${mode} process completed`);
    if (mode === 'train') {
      // Clear training flag when training completes
      setTrainingFlag(false);
      console.log('[Main] Training flag cleared');
    }
    if (onComplete) {
      onComplete(result);
    }
  };

  spawnMLProcess(mode, processData, onProcessComplete);
  console.log(`[Main] ${mode} process spawned. Check console for progress.`);
}

/**
 * Starts training in a separate Node.js process (non-blocking)
 * @deprecated Use startMLPWorker('train', data) instead
 */
export function startTrainingWorker(
  trainingData: any[],
  predictionData: any[],
  features: string[]
): void {
  startMLPWorker('train', { trainingData, predictionData, features });
}

