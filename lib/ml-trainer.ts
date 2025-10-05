import './suppress-tf-logs'  // Must be first!
import * as tf from '@tensorflow/tfjs'

// Set TensorFlow environment
if (typeof global !== 'undefined') {
  process.env.TF_CPP_MIN_LOG_LEVEL = '3'
}

if (typeof tf !== 'undefined' && tf.env) {
  tf.env().set('IS_TEST', true)
}

export const FEATURES = [
  'home_advantage',
  'adjusted_rolling_xg_home', 'adjusted_rolling_xga_home',
  'adjusted_rolling_xg_away', 'adjusted_rolling_xga_away',
  'adjusted_rolling_market_xg_home', 'adjusted_rolling_market_xga_home',
  'adjusted_rolling_market_xg_away', 'adjusted_rolling_market_xga_away',
  'avg_goals_league'
]

export interface TrainingData {
  id: number
  goals_home: number | null
  goals_away: number | null
  [key: string]: any
}

function buildModel(inputSize: number) {
  const uid = Math.random().toString(36).substring(2, 11)
  const model = tf.sequential({
    layers: [
      tf.layers.dense({ inputShape: [inputSize], units: 56, activation: 'relu', name: `d1_${uid}` }),
      tf.layers.batchNormalization({ name: `bn_${uid}` }),
      tf.layers.dropout({ rate: 0.2, name: `do_${uid}` }),
      tf.layers.dense({ units: 2, activation: 'linear', name: `d2_${uid}` })
    ]
  })
  model.compile({ optimizer: tf.train.adam(0.001), loss: 'meanSquaredError' })
  return model
}

export async function trainModel(trainingData: TrainingData[], features = FEATURES) {
  await tf.setBackend('cpu')
  await tf.ready()

  const valid = trainingData.filter(f =>
    features.every(feat => f[feat] != null) && f.goals_home != null && f.goals_away != null
  )
  if (!valid.length) throw new Error('No valid training data')

  const split = Math.floor(valid.length * 0.8)
  const trainX = valid.slice(0, split).map(f => features.map(feat => Number(f[feat])))
  const trainY = valid.slice(0, split).map(f => [Number(f.goals_home), Number(f.goals_away)])
  const valX = valid.slice(split).map(f => features.map(feat => Number(f[feat])))
  const valY = valid.slice(split).map(f => [Number(f.goals_home), Number(f.goals_away)])

  const xTensor = tf.tensor2d(trainX)
  const minVals = xTensor.min(0)
  const maxVals = xTensor.max(0)
  const range = maxVals.sub(minVals).add(1e-7)
  const xNorm = xTensor.sub(minVals).div(range).clipByValue(-5, 5)
  const yTensor = tf.tensor2d(trainY)
  const valXNorm = tf.tensor2d(valX).sub(minVals).div(range).clipByValue(-5, 5)
  const valYTensor = tf.tensor2d(valY)

  const model = buildModel(features.length)
  console.log(`[Training] ${trainX.length} train | ${valX.length} validation`)
  const history = await model.fit(xNorm, yTensor, {
    epochs: 150,
    batchSize: 1024,
    validationData: [valXNorm, valYTensor],
    verbose: 0
  })
  const finalLoss = history.history.loss[history.history.loss.length - 1] as number
  console.log(`[Training] Complete! Final loss: ${finalLoss.toFixed(4)}`)

  xTensor.dispose()
  xNorm.dispose()
  yTensor.dispose()
  valXNorm.dispose()
  valYTensor.dispose()

  return {
    model,
    minVals,
    maxVals,
    range,
    features,
    stats: {
      trainSize: trainX.length,
      finalLoss: history.history.loss[history.history.loss.length - 1] as number,
      trainedAt: new Date().toISOString()
    }
  }
}

export async function makePredictions(
  model: any,
  minVals: any,
  maxVals: any,
  range: any,
  features: string[],
  predictionData: any[]
) {
  const valid = predictionData.filter(f => features.every(feat => f[feat] != null))
  if (!valid.length) return []

  const x = tf.tensor2d(valid.map(f => features.map(feat => Number(f[feat]))))
  const xNorm = x.sub(minVals).div(range).clipByValue(-5, 5)
  const preds = model.predict(xNorm) as tf.Tensor
  const arr = await preds.array() as number[][]

  x.dispose()
  xNorm.dispose()
  preds.dispose()

  return valid.map((f, i) => ({
    id: f.id,
    home_team_name: f.home_team_name,
    away_team_name: f.away_team_name,
    predicted_home: Math.max(0, Math.round(arr[i][0] * 100) / 100),
    predicted_away: Math.max(0, Math.round(arr[i][1] * 100) / 100)
  }))
}
