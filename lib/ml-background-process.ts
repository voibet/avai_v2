// Standalone script to run ML operations in a separate process
// This is executed as a child process to avoid blocking the main app

import './suppress-tf-logs'  // Must be first!
import { fileURLToPath } from 'url';
import { trainAndPredict } from './ml-evaluation';
import { saveModelToDisk, getCachedModel } from './ml-cache';
import { savePredictions } from './db-utils';
import { makePredictions } from './ml-trainer';


async function runTask() {
  try {
    // Read input data from stdin
    let inputData = '';
    
    process.stdin.on('data', (chunk) => {
      inputData += chunk;
    });

    process.stdin.on('end', async () => {
      try {
        const { mode, trainingData, predictionData, features, batchSize, epochs } = JSON.parse(inputData);
        
        if (mode === 'train') {
          // TRAINING MODE
          console.log(`[Process] Starting training with ${trainingData.length} training fixtures`);
          
          const result = await trainAndPredict({
            trainingData,
            predictionData,
            features,
            calculateMetrics: false
          });

          const { modelData, predictions } = result;
          
          // Save model to disk (shared storage between processes)
          await saveModelToDisk(modelData);
          console.log('[Process] ✓ Model saved to disk');

          const savedCount = await savePredictions(predictions);
          console.log(`[Process] ✓ Saved ${savedCount} predictions to database`);
          console.log(`[Process] Training complete: ${predictions.length} predictions generated`);
          
          // Cleanup tensors
          modelData.model.dispose();
          modelData.minVals.dispose();
          modelData.maxVals.dispose();
          modelData.range.dispose();
          
        } else if (mode === 'predict') {
          // PREDICTION MODE
          console.log(`[Process] Starting predictions with ${predictionData.length} fixtures`);
          
          const modelData = await getCachedModel();
          if (!modelData) {
            throw new Error('No cached model available');
          }

          const predictions = await makePredictions(
            modelData.model,
            modelData.minVals,
            modelData.maxVals,
            modelData.range,
            modelData.features,
            predictionData
          );

          console.log(`[Process] Generated ${predictions.length} predictions`);
          
          const savedCount = await savePredictions(predictions);
          console.log(`[Process] ✓ Saved ${savedCount} predictions to database`);
          console.log(`[Process] Prediction complete`);
          
        } else if (mode === 'test') {
          // TEST MODE (with metrics)
          console.log(`[Process] Starting test training with ${trainingData.length} training fixtures`);
          
          const result = await trainAndPredict({
            trainingData,
            predictionData,
            features,
            epochs: epochs,
            batchSize: batchSize,
            calculateMetrics: true
          });

          console.log(`[Process] Test complete with metrics calculated`);
          
          // Cleanup tensors (test mode doesn't save the model)
          if (result.modelData) {
            result.modelData.model.dispose();
            result.modelData.minVals.dispose();
            result.modelData.maxVals.dispose();
            result.modelData.range.dispose();
          }
        }
        
        process.exit(0);
      } catch (error) {
        console.error('[Process] Error:', error);
        process.exit(1);
      }
    });
  } catch (error) {
    console.error('[Process] Fatal error:', error);
    process.exit(1);
  }
}

// Only run if this is the main module (ES module version)
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  runTask();
}
