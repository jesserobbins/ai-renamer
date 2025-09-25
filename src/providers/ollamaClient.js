const { parseModelResponse } = require('../utils/parseModelResponse')

function createOllamaClient (options, logger) {
  const baseUrl = (options.baseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '')
  const endpoint = `${baseUrl}/api/chat`
  const model = options.model || 'llava:13b'

  async function generateFilename (prompt) {
    const userMessage = {
      role: 'user',
      content: prompt.userMessage
    }

    const attachments = []
    if (prompt.images) {
      prompt.images.forEach(image => attachments.push(image.base64))
    }
    if (prompt.frames) {
      prompt.frames.forEach(frame => attachments.push(frame))
    }

    if (attachments.length) {
      userMessage.images = attachments
    }

    const body = {
      model,
      stream: false,
      messages: [
        { role: 'system', content: prompt.systemMessage },
        userMessage
      ]
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Ollama request failed (${response.status}): ${errorText}`)
    }

    const data = await response.json()
    const messageContent = data.message?.content || data.message
    const parsed = parseModelResponse(messageContent)
    return parsed
  }

  return {
    generateFilename
  }
}

module.exports = {
  createOllamaClient
}
