// Suppress TensorFlow.js verbose logging
// Import this at the TOP of any file that uses TensorFlow

export function suppressTFLogs() {
  const shouldSuppress = (msg: any): boolean => {
    if (typeof msg !== 'string') return false
    return (
      msg.includes('kernel') || 
      msg.includes('backend') || 
      msg.includes('Platform') ||
      msg.includes('already registered') ||
      msg.includes('Overwriting') ||
      msg.includes('Reusing existing') ||
      msg.includes('has already been set')
    )
  }

  const originalWarn = console.warn
  const originalLog = console.log
  const originalInfo = console.info

  console.warn = (...args: any[]) => {
    if (shouldSuppress(args[0])) return
    originalWarn(...args)
  }

  console.log = (...args: any[]) => {
    if (shouldSuppress(args[0])) return
    originalLog(...args)
  }

  console.info = (...args: any[]) => {
    if (shouldSuppress(args[0])) return
    originalInfo(...args)
  }
}

// Auto-suppress when imported
suppressTFLogs()
