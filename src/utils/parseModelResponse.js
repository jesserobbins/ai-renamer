function parseModelResponse (text) {
  if (!text) {
    throw new Error('Model returned empty response')
  }

  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch (error) {
    const firstBrace = trimmed.indexOf('{')
    const lastBrace = trimmed.lastIndexOf('}')
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const candidate = trimmed.slice(firstBrace, lastBrace + 1)
      try {
        return JSON.parse(candidate)
      } catch (err) {
        throw new Error(`Unable to parse model response as JSON: ${err.message}\nResponse: ${trimmed}`)
      }
    }
    throw new Error(`Unable to parse model response as JSON: ${error.message}\nResponse: ${trimmed}`)
  }
}

module.exports = {
  parseModelResponse
}
