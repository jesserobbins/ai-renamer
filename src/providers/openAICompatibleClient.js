const { parseModelResponse } = require('../utils/parseModelResponse')

function createOpenAICompatibleClient (options, logger) {
  const baseUrl = (options.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')
  const endpoint = `${baseUrl}/chat/completions`
  const model = options.model || (options.provider === 'lm-studio' ? 'lmstudio-community/llava' : 'gpt-4o')

  async function generateFilename (prompt) {
    const headers = {
      'Content-Type': 'application/json'
    }
    if (options.apiKey) {
      headers.Authorization = `Bearer ${options.apiKey}`
    }

    const userContent = [{ type: 'text', text: prompt.userMessage }]
    const images = prompt.images || []
    const frames = prompt.frames || []

    images.forEach(image => {
      userContent.push({ type: 'image', image_base64: image.base64, media_type: image.mediaType })
    })

    frames.forEach(frame => {
      userContent.push({ type: 'image', image_base64: frame, media_type: 'image/jpeg' })
    })

    const body = {
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [{ type: 'text', text: prompt.systemMessage }]
        },
        {
          role: 'user',
          content: userContent
        }
      ]
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Provider request failed (${response.status}): ${errorText}`)
    }

    const data = await response.json()
    const message = data.choices?.[0]?.message?.content
    const parsed = parseModelResponse(message)
    return parsed
  }

  return {
    generateFilename
  }
}

module.exports = {
  createOpenAICompatibleClient
}
