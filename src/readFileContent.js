const path = require('path')
const { promises: fs } = require('fs')
const { inflateRawSync } = require('zlib')
const pdf = require('pdf-parse')

const { convertBinaryOfficeToDocx } = require('./binaryOfficeConversion')

const logVerbose = (verbose, message) => {
  if (!verbose) return
  console.log(message)
}

const DOCX_LIKE_EXTENSIONS = new Set(['.docx', '.docm', '.dotx', '.dotm'])
const PPTX_LIKE_EXTENSIONS = new Set(['.pptx', '.pptm', '.ppsx', '.ppsm', '.potx', '.potm'])
const XLSX_LIKE_EXTENSIONS = new Set(['.xlsx', '.xlsm', '.xlsb', '.xltx', '.xltm'])
const BINARY_OFFICE_WARNINGS = {
  '.doc': 'The .doc format is not supported for text extraction. Please convert the file to .docx or run with --convertbinary.',
  '.dot': 'The .dot template format is not supported for text extraction. Please convert the file to .dotx or run with --convertbinary.',
  '.ppt': 'The .ppt format is not supported for text extraction. Please convert the file to .pptx or run with --convertbinary.',
  '.pps': 'The .pps format is not supported for text extraction. Please convert the file to .ppsx or run with --convertbinary.',
  '.pot': 'The .pot template format is not supported for text extraction. Please convert the file to .potx or run with --convertbinary.',
  '.xls': 'The .xls format is not supported for text extraction. Please convert the file to .xlsx or run with --convertbinary.',
  '.xlt': 'The .xlt template format is not supported for text extraction. Please convert the file to .xltx or run with --convertbinary.'
}

const OPEN_DOCUMENT_TEXT_EXTENSIONS = new Set(['.odt'])
const OPEN_DOCUMENT_PRESENTATION_EXTENSIONS = new Set(['.odp'])
const OPEN_DOCUMENT_SPREADSHEET_EXTENSIONS = new Set(['.ods'])
const KEYNOTE_EXTENSIONS = new Set(['.key'])

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50

const decodeXmlEntities = (input) => {
  if (!input) return ''
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const codePoint = parseInt(hex, 16)
      return Number.isNaN(codePoint) ? '' : String.fromCodePoint(codePoint)
    })
    .replace(/&#([0-9]+);/g, (_, dec) => {
      const codePoint = parseInt(dec, 10)
      return Number.isNaN(codePoint) ? '' : String.fromCodePoint(codePoint)
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

const normalizeWhitespace = (text) => {
  return text
    .split('\n')
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

const parseZipEntries = (buffer) => {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('Expected a buffer when parsing a zip archive')
  }

  let eocdOffset = -1
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocdOffset = i
      break
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Invalid archive: End of central directory record not found')
  }

  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16)
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10)

  const entries = new Map()
  let offset = centralDirectoryOffset

  for (let i = 0; i < totalEntries; i++) {
    const signature = buffer.readUInt32LE(offset)
    if (signature !== CENTRAL_DIRECTORY_SIGNATURE) {
      break
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const fileNameLength = buffer.readUInt16LE(offset + 28)
    const extraFieldLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localHeaderOffset = buffer.readUInt32LE(offset + 42)

    const nameStart = offset + 46
    const fileName = buffer.slice(nameStart, nameStart + fileNameLength).toString('utf8')

    const localHeaderSignature = buffer.readUInt32LE(localHeaderOffset)
    if (localHeaderSignature !== LOCAL_FILE_HEADER_SIGNATURE) {
      offset = nameStart + fileNameLength + extraFieldLength + commentLength
      continue
    }

    const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26)
    const localExtraFieldLength = buffer.readUInt16LE(localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraFieldLength
    const dataEnd = dataStart + compressedSize
    const fileData = buffer.slice(dataStart, dataEnd)

    let decompressed
    if (compressionMethod === 0) {
      decompressed = fileData
    } else if (compressionMethod === 8) {
      decompressed = inflateRawSync(fileData)
    } else {
      throw new Error(`Unsupported compression method ${compressionMethod} encountered in archive`)
    }

    entries.set(fileName, decompressed)

    offset = nameStart + fileNameLength + extraFieldLength + commentLength
  }

  return entries
}

const extractDocxText = (entries) => {
  const relevantFiles = Array.from(entries.keys()).filter((file) => {
    if (!file.startsWith('word/') || !file.endsWith('.xml')) return false
    return /document|header|footer|footnotes|endnotes/i.test(file)
  }).sort()

  const paragraphs = []
  const paragraphRegex = /<w:p[\s\S]*?<\/w:p>/g

  const extractParagraphText = (paragraphXml) => {
    const tokensRegex = /(<w:t[^>]*>[\s\S]*?<\/w:t>)|(<w:tab[^>]*\/>)+|(<w:br[^>]*\/>)|(<w:cr[^>]*\/>)|(<w:pBreak[^>]*\/>)|(<w:tbl>[\s\S]*?<\/w:tbl>)/g
    tokensRegex.lastIndex = 0
    const tokens = []
    let match

    while ((match = tokensRegex.exec(paragraphXml)) !== null) {
      const [token] = match
      if (token.startsWith('<w:t')) {
        const text = token.replace(/<w:t[^>]*>/, '').replace(/<\/w:t>/, '')
        tokens.push(decodeXmlEntities(text))
      } else if (token.startsWith('<w:tab')) {
        const tabCount = (token.match(/<w:tab[^>]*\/>/g) || ['']).length
        tokens.push('\t'.repeat(tabCount))
      } else if (token.startsWith('<w:tbl')) {
        const cellText = token
          .replace(/<w:tr[^>]*>/g, '\n')
          .replace(/<\/w:tr>/g, '\n')
          .replace(/<w:tc[^>]*>/g, '\t')
          .replace(/<\/w:tc>/g, '\t')
        const stripped = cellText.replace(/<[^>]+>/g, '')
        tokens.push(decodeXmlEntities(stripped))
      } else {
        tokens.push('\n')
      }
    }

    const combined = tokens.join('')
    const lines = combined.split('\n')
      .map((line) => line.replace(/[\t ]+/g, ' ').trim())
      .filter(Boolean)
    return lines.join('\n')
  }

  for (const file of relevantFiles) {
    const xml = entries.get(file).toString('utf8')
    paragraphRegex.lastIndex = 0
    let match
    while ((match = paragraphRegex.exec(xml)) !== null) {
      const paragraphText = extractParagraphText(match[0])
      if (paragraphText) {
        paragraphs.push(paragraphText)
      }
    }
  }

  return paragraphs.join('\n\n').trim()
}

const naturalCompare = (a, b) => {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

const extractPptxText = (entries) => {
  const slideFiles = Array.from(entries.keys())
    .filter((file) => /^ppt\/slides\/slide[0-9]+\.xml$/i.test(file))
    .sort(naturalCompare)

  const slides = []
  for (const file of slideFiles) {
    const xml = entries.get(file).toString('utf8')
      .replace(/<a:br[^>]*\/>/g, '\n')
      .replace(/<a:tab[^>]*\/>/g, '\t')

    const textSegments = []
    const textRegex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g
    let match
    while ((match = textRegex.exec(xml)) !== null) {
      const segment = decodeXmlEntities(match[1])
      const cleaned = segment.split('\n').map((line) => line.replace(/[\t ]+/g, ' ').trim()).filter(Boolean).join('\n')
      if (cleaned) {
        textSegments.push(cleaned)
      }
    }

    const slideText = textSegments.join('\n')
    if (slideText) {
      slides.push(slideText)
    }
  }

  return slides.join('\n\n').trim()
}

const extractKeynoteText = (entries) => {
  let keynoteFile = null
  for (const candidate of ['index.apxl', 'Index.apxl']) {
    if (entries.has(candidate)) {
      keynoteFile = entries.get(candidate)
      break
    }
  }

  if (!keynoteFile) return ''

  const xml = keynoteFile.toString('utf8')
    .replace(/<sf:tab[^>]*\/>/g, '\t')
    .replace(/<sf:lineBreak[^>]*\/>/g, '\n')

  const text = xml.replace(/<[^>]+>/g, ' ')
  return normalizeWhitespace(decodeXmlEntities(text))
}

const extractSharedStrings = (entries) => {
  const sharedStrings = []
  if (!entries.has('xl/sharedStrings.xml')) return sharedStrings

  const xml = entries.get('xl/sharedStrings.xml').toString('utf8')
  const stringRegex = /<si[^>]*>([\s\S]*?)<\/si>/g
  let match
  while ((match = stringRegex.exec(xml)) !== null) {
    const segment = match[1]
    const textPieces = []
    const textRegex = /<t[^>]*>([\s\S]*?)<\/t>/g
    let textMatch
    while ((textMatch = textRegex.exec(segment)) !== null) {
      textPieces.push(decodeXmlEntities(textMatch[1]))
    }
    const combined = textPieces.join('')
    sharedStrings.push(combined)
  }

  return sharedStrings
}

const buildSheetNameMap = (entries) => {
  const sheetNameByRelId = new Map()
  const sheetTargets = new Map()

  if (entries.has('xl/workbook.xml')) {
    const workbookXml = entries.get('xl/workbook.xml').toString('utf8')
    const sheetRegex = /<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*>/g
    let match
    while ((match = sheetRegex.exec(workbookXml)) !== null) {
      const [, name, relId] = match
      sheetNameByRelId.set(relId, decodeXmlEntities(name))
    }
  }

  if (entries.has('xl/_rels/workbook.xml.rels')) {
    const relsXml = entries.get('xl/_rels/workbook.xml.rels').toString('utf8')
    const relRegex = /<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g
    let match
    while ((match = relRegex.exec(relsXml)) !== null) {
      const [, relId, target] = match
      const sheetName = sheetNameByRelId.get(relId)
      if (!sheetName) continue

      let normalizedTarget = target
      if (!normalizedTarget.startsWith('/')) {
        normalizedTarget = `xl/${normalizedTarget.replace(/^\.\//, '')}`
      } else {
        normalizedTarget = `xl${normalizedTarget}`
      }
      sheetTargets.set(normalizedTarget, sheetName)
    }
  }

  return sheetTargets
}

const extractSheetText = (xml, sharedStrings) => {
  const rows = []
  const rowRegex = /<row[^>]*>([\s\S]*?)<\/row>/g
  let rowMatch

  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    const rowCells = []
    const cellRegex = /<c([^>]*)>([\s\S]*?)<\/c>/g
    let cellMatch
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      const [, rawAttributes, cellBody] = cellMatch
      const typeMatch = /t="([^"]+)"/.exec(rawAttributes)
      let cellValue = ''

      if (typeMatch && typeMatch[1] === 's') {
        const valueMatch = /<v>([\s\S]*?)<\/v>/.exec(cellBody)
        if (valueMatch) {
          const index = parseInt(valueMatch[1], 10)
          if (!Number.isNaN(index) && sharedStrings[index]) {
            cellValue = sharedStrings[index]
          }
        }
      } else if (typeMatch && typeMatch[1] === 'inlineStr') {
        const inlinePieces = []
        const inlineRegex = /<t[^>]*>([\s\S]*?)<\/t>/g
        let inlineMatch
        while ((inlineMatch = inlineRegex.exec(cellBody)) !== null) {
          inlinePieces.push(decodeXmlEntities(inlineMatch[1]))
        }
        cellValue = inlinePieces.join('')
      } else {
        const valueMatch = /<v>([\s\S]*?)<\/v>/.exec(cellBody)
        if (valueMatch) {
          cellValue = decodeXmlEntities(valueMatch[1])
        }
      }

      if (!cellValue) {
        const textMatch = /<t[^>]*>([\s\S]*?)<\/t>/.exec(cellBody)
        if (textMatch) {
          cellValue = decodeXmlEntities(textMatch[1])
        }
      }

      rowCells.push(cellValue.replace(/[\t ]+/g, ' ').trim())
    }

    if (rowCells.some((cell) => cell.length > 0)) {
      rows.push(rowCells)
    }
  }

  const lines = rows.map((cells) => cells.join('\t').trim()).filter(Boolean)
  return lines.join('\n')
}

const extractXlsxText = (entries) => {
  const sharedStrings = extractSharedStrings(entries)
  const sheetNames = buildSheetNameMap(entries)

  const sheetFiles = Array.from(entries.keys())
    .filter((file) => /^xl\/worksheets\/[\w-]+\.xml$/i.test(file))
    .sort(naturalCompare)

  const sheets = []
  for (const file of sheetFiles) {
    const sheetXml = entries.get(file).toString('utf8')
    const sheetText = extractSheetText(sheetXml, sharedStrings)
    if (sheetText) {
      const displayName = sheetNames.get(file) || file.replace(/^xl\/worksheets\//, '').replace(/\.xml$/i, '')
      sheets.push(`Sheet: ${displayName}\n${sheetText}`)
    }
  }

  return sheets.join('\n\n').trim()
}

const extractOpenDocumentText = (entries) => {
  if (!entries.has('content.xml')) return ''
  const xml = entries.get('content.xml').toString('utf8')
    .replace(/<text:line-break\s*\/>/g, '\n')
    .replace(/<text:tab\s*\/>/g, '\t')
    .replace(/<draw:frame[^>]*>/g, '\n')
    .replace(/<\/draw:frame>/g, '\n')

  const stripped = xml.replace(/<[^>]+>/g, ' ')
  return normalizeWhitespace(decodeXmlEntities(stripped))
}

const readPdf = async (filePath) => {
  const dataBuffer = await fs.readFile(filePath)
  const pdfData = await pdf(dataBuffer)
  return pdfData.text.trim()
}

const readDocxLike = async (filePath) => {
  const buffer = await fs.readFile(filePath)
  const entries = parseZipEntries(buffer)
  return extractDocxText(entries)
}

const readPptxLike = async (filePath) => {
  const buffer = await fs.readFile(filePath)
  const entries = parseZipEntries(buffer)
  return extractPptxText(entries)
}

const readKeynote = async (filePath) => {
  const buffer = await fs.readFile(filePath)
  const entries = parseZipEntries(buffer)
  return extractKeynoteText(entries)
}

const readXlsxLike = async (filePath) => {
  const buffer = await fs.readFile(filePath)
  const entries = parseZipEntries(buffer)
  return extractXlsxText(entries)
}

const readOpenDocument = async (filePath) => {
  const buffer = await fs.readFile(filePath)
  const entries = parseZipEntries(buffer)
  return extractOpenDocumentText(entries)
}

const readRtf = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf8')

  const normalized = raw
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => {
      const codePoint = parseInt(hex, 16)
      return Number.isNaN(codePoint) ? '' : String.fromCharCode(codePoint)
    })
    .replace(/\\par[d]?/g, '\n')
    .replace(/\\tab/g, '\t')
    .replace(/\\line/g, '\n')
    .replace(/\\\\/g, '\\')
    .replace(/\\~|\\-/g, ' ')
    .replace(/\\[^\s]+ ?/g, '')
    .replace(/[{}]/g, '')

  return normalizeWhitespace(normalized)
}

module.exports = async ({ filePath, convertBinary = false, verbose = false }) => {
  const ext = path.extname(filePath).toLowerCase()
  const fileName = path.basename(filePath)

  logVerbose(verbose, `📚 Reading ${fileName} (extension: ${ext || 'none'})`)

  if (ext === '.pdf') {
    logVerbose(verbose, '📑 Parsing PDF document')
    return readPdf(filePath)
  }

  if (DOCX_LIKE_EXTENSIONS.has(ext)) {
    logVerbose(verbose, '📝 Parsing DOCX-like archive')
    return readDocxLike(filePath)
  }

  if (PPTX_LIKE_EXTENSIONS.has(ext)) {
    logVerbose(verbose, '🖼️ Parsing PPTX-like presentation')
    return readPptxLike(filePath)
  }

  if (XLSX_LIKE_EXTENSIONS.has(ext)) {
    logVerbose(verbose, '📊 Parsing XLSX-like spreadsheet')
    return readXlsxLike(filePath)
  }

  if (KEYNOTE_EXTENSIONS.has(ext)) {
    logVerbose(verbose, '🗣️ Parsing Keynote presentation bundle')
    return readKeynote(filePath)
  }

  if (OPEN_DOCUMENT_TEXT_EXTENSIONS.has(ext) || OPEN_DOCUMENT_PRESENTATION_EXTENSIONS.has(ext) || OPEN_DOCUMENT_SPREADSHEET_EXTENSIONS.has(ext)) {
    logVerbose(verbose, '🧭 Parsing OpenDocument file')
    return readOpenDocument(filePath)
  }

  if (ext === '.rtf') {
    logVerbose(verbose, '📜 Parsing RTF document')
    return readRtf(filePath)
  }

  if (BINARY_OFFICE_WARNINGS[ext]) {
    if (convertBinary) {
      logVerbose(verbose, `⚙️ Converting legacy ${ext} file for ${fileName}`)
      const { tempPath, cleanup } = await convertBinaryOfficeToDocx({ filePath, ext, verbose })
      try {
        const text = await readDocxLike(tempPath)
        logVerbose(verbose, `🧾 Extracted text from converted document at ${tempPath}`)
        return text
      } finally {
        await cleanup()
        logVerbose(verbose, `🧹 Cleaned temporary files for ${fileName}`)
      }
    }

    logVerbose(verbose, `⚠️ Conversion disabled for ${fileName}; raising warning`)
    throw new Error(BINARY_OFFICE_WARNINGS[ext])
  }

  logVerbose(verbose, '📄 Reading file as UTF-8 text')
  const content = await fs.readFile(filePath, 'utf8')
  return typeof content === 'string' ? content : content.toString('utf8')
}
