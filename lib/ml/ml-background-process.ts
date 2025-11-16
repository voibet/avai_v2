// Standalone script to run ML operations in a separate process
// This is executed as a child process to avoid blocking the main app

import './suppress-tf-logs'  // Must be first!
import { fileURLToPath } from 'url';
import { trainAndPredict } from './ml-evaluation';
import { saveModelToDisk, getCachedModel } from './ml-cache';
import { savePredictions } from '../database/db-utils';
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
          // TEST MODE (with metrics and prediction saving)
          // Redirect ALL console output to stderr so stdout contains only JSON results
          const originalConsoleLog = console.log;
          const originalConsoleError = console.error;
          console.log = (...args) => originalConsoleError(...args);
          console.error = (...args) => originalConsoleError(...args);

          let result;
          try {
            result = await trainAndPredict({
              trainingData,
              predictionData,
              features,
              epochs: epochs,
              batchSize: batchSize,
              calculateMetrics: true
            });

            // Save test predictions to database
            const savedCount = await savePredictions(result.predictions);
            console.error(`[Process] ✓ Saved ${savedCount} test predictions to database`);

            // Output results to parent process via stdout (JSON only)
            const testResults = {
              success: true,
              message: 'Model performance test completed successfully',
              config: {
                features,
                epochs,
                batchSize
              },
              metrics: result.metrics,
              data: {
                totalFixtures: trainingData.length + predictionData.length,
                trainFixtures: trainingData.length,
                testFixtures: predictionData.length,
                predictionsSaved: savedCount
              },
              modelStats: result.modelData.stats
            };

            // Write results to stdout for parent process to capture
            process.stdout.write(JSON.stringify(testResults));
          } finally {
            // Restore console methods
            console.log = originalConsoleLog;
            console.error = originalConsoleError;
          }

          // Cleanup tensors (test mode doesn't save the model)
          if (result && result.modelData) {
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
