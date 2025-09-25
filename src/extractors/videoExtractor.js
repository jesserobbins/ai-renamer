const fs = require('fs/promises')
const path = require('path')
const os = require('os')
const { randomUUID } = require('crypto')
const { exec } = require('child_process')

function execAsync (command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout) => {
      if (error) {
        reject(new Error(error.message))
        return
      }
      resolve(stdout)
    })
  })
}

async function extractFrames ({ filePath, frameCount }) {
  const tmpDir = path.join(os.tmpdir(), `ai-renamer-${randomUUID()}`)
  await fs.mkdir(tmpDir, { recursive: true })

  try {
    const durationCommand = `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`
    const durationOutput = await execAsync(durationCommand)
    const duration = parseFloat(durationOutput.trim()) || 0

    const safeFrameCount = Math.max(1, Math.min(frameCount, Math.max(1, Math.floor(duration))))
    const frameRate = Math.max(1 / Math.max(duration, 1), safeFrameCount / Math.max(duration, 1))
    const extractCommand = `ffmpeg -i "${filePath}" -vf fps=${frameRate} -frames:v ${safeFrameCount} -q:v 2 "${tmpDir}/frame_%03d.jpg" -loglevel error`
    await execAsync(extractCommand)

    const frames = []
    for (let i = 1; i <= safeFrameCount; i++) {
      const framePath = path.join(tmpDir, `frame_${String(i).padStart(3, '0')}.jpg`)
      const frameBuffer = await fs.readFile(framePath)
      frames.push(frameBuffer.toString('base64'))
    }

    return {
      frames,
      duration,
      frameCount: safeFrameCount
    }
  } catch (error) {
    return {
      frames: [],
      duration: 0,
      frameCount: 0,
      error: error.message
    }
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch (err) {}
  }
}

module.exports = {
  extractFrames
}
