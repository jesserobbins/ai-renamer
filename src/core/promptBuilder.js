function buildDefaultSystemMessage (options) {
  return `You are an analyst tasked with renaming downloaded diligence artifacts. Read the provided context and return a JSON object with the following shape:\n{\n  "filename": string,\n  "subject": string | null,\n  "subject_confidence": number (0-1),\n  "summary": string\n}.\n- The filename MUST be concise, descriptive, and avoid filesystem-invalid characters.\n- Prefer ${options.case || 'kebabCase'} case.\n- Honour the requested language: ${options.language || 'English'}.\n- Subjects represent the company, project, or person tied to the file. Use null if you are unsure.\n- subject_confidence should reflect how certain you are about the subject.`
}

function buildPrompt ({ content, options, subjectHints, instructionSet }) {
  const systemMessage = instructionSet?.systemMessage || buildDefaultSystemMessage(options)

  const segments = []
  segments.push(`Original filename: ${content.fileName}`)
  segments.push(`Extension: ${content.extension}`)
  segments.push(`Size: ${content.sizeBytes} bytes`)
  segments.push(`Modified: ${content.modifiedAt}`)

  if (content.metadata) {
    const metadataLines = Object.entries(content.metadata)
      .filter(([, value]) => value)
      .map(([key, value]) => `${key}: ${value}`)
    if (metadataLines.length) {
      segments.push('Metadata:')
      segments.push(...metadataLines)
    }
  }

  if (content.text) {
    segments.push('Extracted text snippet:')
    segments.push(content.text)
  }

  if (content.image) {
    const preview = content.image.base64.slice(0, 4000)
    segments.push('Image preview (base64, truncated):')
    segments.push(preview)
  }

  if (content.binarySnippet) {
    segments.push('Binary preview (base64, truncated):')
    segments.push(content.binarySnippet)
  }

  if (content.frames && content.frames.length) {
    const duration = typeof content.duration === 'number' ? content.duration.toFixed(1) : content.duration
    segments.push(`Video context: ${content.frameCount} frames sampled over ${duration} seconds.`)
    if (content.frameError) {
      segments.push(`Frame extraction warning: ${content.frameError}`)
    }
  }

  if (content.frameError && !content.frames?.length) {
    segments.push(`Unable to extract frames: ${content.frameError}`)
  }

  if (subjectHints && subjectHints.length) {
    segments.push(`Known subjects in this workspace: ${subjectHints.join(', ')}`)
  }

  if (instructionSet?.subjectStopwords?.length) {
    segments.push('Subject tokens to ignore:')
    segments.push(instructionSet.subjectStopwords.join(', '))
  }

  if (options.customPrompt) {
    segments.push(`Additional instructions: ${options.customPrompt}`)
  }

  const userMessage = segments.join('\\n\\n')

  return {
    systemMessage,
    userMessage,
    images: content.image ? [content.image] : [],
    frames: content.frames || []
  }
}

module.exports = {
  buildPrompt
}
