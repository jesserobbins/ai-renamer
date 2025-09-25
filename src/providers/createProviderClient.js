const { createOllamaClient } = require('./ollamaClient')
const { createOpenAICompatibleClient } = require('./openAICompatibleClient')

function createProviderClient (options, logger) {
  const provider = (options.provider || 'ollama').toLowerCase()
  if (provider === 'ollama') {
    return createOllamaClient(options, logger)
  }
  if (provider === 'lm-studio') {
    return createOpenAICompatibleClient({ ...options, baseUrl: options.baseUrl || 'http://127.0.0.1:1234' }, logger)
  }
  if (provider === 'openai') {
    if (!options.apiKey) {
      throw new Error('OpenAI provider requires --api-key to be set')
    }
    return createOpenAICompatibleClient({ ...options, baseUrl: options.baseUrl || 'https://api.openai.com/v1' }, logger)
  }
  throw new Error(`Unsupported provider: ${provider}`)
}

module.exports = {
  createProviderClient
}
