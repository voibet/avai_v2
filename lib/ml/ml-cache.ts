// Global singleton cache for trained model
// This persists in memory until the server restarts
import './suppress-tf-logs'  // Must be first!
import * as tf from '@tensorflow/tfjs'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

if (typeof tf !== 'undefined' && tf.env) {
  tf.env().set('IS_TEST', true)
}

interface ModelCache {
  model: any
  minVals: any
  maxVals: any
  range: any
  features: string[]
  stats: {
    trainSize: number
    finalLoss: number
    trainedAt: string
  }
}

interface ModelMetadata {
  features: string[]
  stats: {
    trainSize: number
    finalLoss: number
    trainedAt: string
  }
  minVals: number[]
  maxVals: number[]
  range: number[]
}

// Use global to ensure cache persists across Next.js hot reloads
declare global {
  var mlModelCache: ModelCache | null | undefined
  var isTraining: boolean | undefined
}

const MODEL_DIR = join(process.cwd(), '.ml-cache')
const MODEL_WEIGHTS_PATH = join(MODEL_DIR, 'model-weights.json')
const MODEL_TOPOLOGY_PATH = join(MODEL_DIR, 'model-topology.json')
const METADATA_PATH = join(MODEL_DIR, 'metadata.json')

// Ensure cache directory exists
if (!existsSync(MODEL_DIR)) {
  mkdirSync(MODEL_DIR, { recursive: true })
}

export async function getCachedModel(): Promise<ModelCache | null> {
  // First try in-memory cache
  if (global.mlModelCache) {
    return global.mlModelCache
  }

  // Try loading from disk
  try {
    if (existsSync(METADATA_PATH) && existsSync(MODEL_TOPOLOGY_PATH) && existsSync(MODEL_WEIGHTS_PATH)) {
      console.log('[Cache] Loading model from disk...')
      
      const metadata: ModelMetadata = JSON.parse(readFileSync(METADATA_PATH, 'utf-8'))
      const topology = JSON.parse(readFileSync(MODEL_TOPOLOGY_PATH, 'utf-8'))
      const weightsData = JSON.parse(readFileSync(MODEL_WEIGHTS_PATH, 'utf-8'))
      
      // Reconstruct model from topology
      const model = await tf.models.modelFromJSON(topology)
      
      // Set weights
      const weightValues = weightsData.map((w: any) => tf.tensor(w.data, w.shape, w.dtype))
      model.setWeights(weightValues)
      
      const minVals = tf.tensor1d(metadata.minVals)
      const maxVals = tf.tensor1d(metadata.maxVals)
      const range = tf.tensor1d(metadata.range)

      const modelData: ModelCache = {
        model,
        minVals,
        maxVals,
        range,
        features: metadata.features,
        stats: metadata.stats
      }

      // Cache in memory for faster access
      global.mlModelCache = modelData
      console.log('[Cache] ✓ Model loaded from disk')
      return modelData
    }
  } catch (error) {
    console.error('[Cache] Error loading model from disk:', error)
  }

  return null
}

export async function setCachedModel(modelData: ModelCache) {
  // Dispose old model if exists
  if (global.mlModelCache) {
    try {
      global.mlModelCache.model.dispose()
      global.mlModelCache.minVals.dispose()
      global.mlModelCache.maxVals.dispose()
      global.mlModelCache.range.dispose()
      console.log('[Cache] Old model disposed')
    } catch (err) {
      console.error('[Cache] Error disposing old model:', err)
    }
  }
  
  // Cache in memory
  global.mlModelCache = modelData
  
  // Save to disk
  await saveModelToDisk(modelData)
  console.log('[Cache] ✓ Model cached in memory and saved to disk')
}

export async function saveModelToDisk(modelData: ModelCache) {
  try {
    // Save model topology
    const topology = modelData.model.toJSON(null, false)
    writeFileSync(MODEL_TOPOLOGY_PATH, JSON.stringify(topology, null, 2))
    
    // Save model weights
    const weights = modelData.model.getWeights()
    const weightsData = await Promise.all(
      weights.map(async (w: any) => ({
        data: Array.from(await w.data()),
        shape: w.shape,
        dtype: w.dtype
      }))
    )
    writeFileSync(MODEL_WEIGHTS_PATH, JSON.stringify(weightsData, null, 2))
    
    // Save metadata
    const minValsArray = await modelData.minVals.array() as number[]
    const maxValsArray = await modelData.maxVals.array() as number[]
    const rangeArray = await modelData.range.array() as number[]
    
    const metadata: ModelMetadata = {
      features: modelData.features,
      stats: modelData.stats,
      minVals: minValsArray,
      maxVals: maxValsArray,
      range: rangeArray
    }
    
    writeFileSync(METADATA_PATH, JSON.stringify(metadata, null, 2))
    console.log('[Cache] ✓ Model saved to disk (topology, weights, metadata)')
  } catch (error) {
    console.error('[Cache] Error saving model to disk:', error)
    throw error
  }
}


export async function hasCachedModel(): Promise<boolean> {
  // Check in-memory cache
  if (global.mlModelCache !== null && global.mlModelCache !== undefined) {
    return true
  }
  
  // Check disk cache - all three files must exist
  return existsSync(METADATA_PATH) && existsSync(MODEL_TOPOLOGY_PATH) && existsSync(MODEL_WEIGHTS_PATH)
}

export function setTrainingFlag(value: boolean) {
  global.isTraining = value
}

export function isCurrentlyTraining() {
  return global.isTraining === true
}
