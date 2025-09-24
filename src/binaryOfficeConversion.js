const path = require('path')
const os = require('os')
const { promises: fs } = require('fs')
const { execFile } = require('child_process')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50

const MIN_LINE_LENGTH = 3

const BINARY_OFFICE_KINDS = {
  '.doc': 'word',
  '.dot': 'word',
  '.ppt': 'presentation',
  '.pps': 'presentation',
  '.pot': 'presentation',
  '.xls': 'spreadsheet',
  '.xlt': 'spreadsheet'
}

const ALLOWED_LIBRARY_EXTENSIONS = new Set(['.docx', '.dotx'])

const logVerbose = (verbose, message) => {
  if (!verbose) return
  console.log(message)
}

const escapeXml = (input) => {
  if (!input) return ''
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

const toDosDateTime = (date) => {
  const year = Math.max(1980, date.getFullYear())
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  return { dosDate, dosTime }
}

const crc32Table = new Uint32Array(256).map((_, index) => {
  let c = index
  for (let k = 0; k < 8; k++) {
    if (c & 1) {
      c = 0xedb88320 ^ (c >>> 1)
    } else {
      c >>>= 1
    }
  }
  return c >>> 0
})

const crc32 = (buffer) => {
  let crc = 0 ^ 0xffffffff
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i]
    crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

const createStoredZip = (files) => {
  const localParts = []
  const centralParts = []
  let offset = 0
  const now = new Date()
  const { dosDate, dosTime } = toDosDateTime(now)

  for (const file of files) {
    const nameBuffer = Buffer.from(file.name, 'utf8')
    const dataBuffer = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8')
    const crc = crc32(dataBuffer)

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(LOCAL_FILE_HEADER_SIGNATURE, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0, 6)
    localHeader.writeUInt16LE(0, 8)
    localHeader.writeUInt16LE(dosTime, 10)
    localHeader.writeUInt16LE(dosDate, 12)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(dataBuffer.length, 18)
    localHeader.writeUInt32LE(dataBuffer.length, 22)
    localHeader.writeUInt16LE(nameBuffer.length, 26)
    localHeader.writeUInt16LE(0, 28)

    const localEntry = Buffer.concat([localHeader, nameBuffer, dataBuffer])
    localParts.push(localEntry)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(CENTRAL_DIRECTORY_SIGNATURE, 0)
    centralHeader.writeUInt16LE(0x0314, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0, 8)
    centralHeader.writeUInt16LE(0, 10)
    centralHeader.writeUInt16LE(dosTime, 12)
    centralHeader.writeUInt16LE(dosDate, 14)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(dataBuffer.length, 20)
    centralHeader.writeUInt32LE(dataBuffer.length, 24)
    centralHeader.writeUInt16LE(nameBuffer.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)

    const centralEntry = Buffer.concat([centralHeader, nameBuffer])
    centralParts.push(centralEntry)

    offset += localEntry.length
  }

  const localSection = Buffer.concat(localParts)
  const centralSection = Buffer.concat(centralParts)

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralSection.length, 12)
  eocd.writeUInt32LE(localSection.length, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([localSection, centralSection, eocd])
}

const collectSegments = (text, matchRegex, stripRegex) => {
  if (!text) return []
  const matches = text.match(matchRegex) || []
  const results = []
  for (const match of matches) {
    const cleaned = match
      .replace(stripRegex, ' ')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    results.push(...cleaned)
  }
  return results
}

const extractBinaryLines = (buffer) => {
  const lines = []
  const seen = new Set()

  const pushLines = (candidates) => {
    for (const candidate of candidates) {
      if (!candidate || candidate.length < MIN_LINE_LENGTH) continue
      if (seen.has(candidate)) continue
      seen.add(candidate)
      lines.push(candidate)
    }
  }

  const asciiText = buffer.toString('latin1')
  pushLines(collectSegments(asciiText, /[\x20-\x7E\s]{4,}/g, /[^\x20-\x7E\s]/g))

  const unicodeText = buffer.toString('utf16le')
  pushLines(collectSegments(unicodeText, /[\u0020-\uD7FF\uE000-\uFFFD\s]{4,}/g, /[^\u0020-\uD7FF\uE000-\uFFFD\s]/g))

  const utf8Text = buffer.toString('utf8')
  pushLines(collectSegments(utf8Text, /[\u0020-\uD7FF\uE000-\uFFFD\s]{4,}/g, /[^\u0020-\uD7FF\uE000-\uFFFD\s]/g))

  return lines
}

const buildDocxBuffer = (lines) => {
  const paragraphs = lines.length > 0 ? lines : ['Converted legacy Office document']
  const bodyContent = paragraphs.map((line) => {
    return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`
  }).join('')

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>${bodyContent}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body>
</w:document>`

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`

  const packageRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
</w:styles>`

  const files = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypesXml, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(packageRelsXml, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') },
    { name: 'word/styles.xml', data: Buffer.from(stylesXml, 'utf8') }
  ]

  return createStoredZip(files)
}

const isInsideDirectory = (directory, target) => {
  if (!directory) return false
  const relative = path.relative(directory, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

let doc2docxLoader

const loadDoc2Docx = async () => {
  if (doc2docxLoader === undefined) {
    doc2docxLoader = import('doc2docx')
      .then((mod) => mod?.default ?? mod)
      .catch(() => null)
  }
  return doc2docxLoader
}

const fileExists = async (filePath) => {
  try {
    await fs.access(filePath)
    return true
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return false
    throw err
  }
}

const findConvertedFile = async ({ dir, baseName, extensions }) => {
  try {
    const entries = await fs.readdir(dir)
    const normalizedBase = baseName.toLowerCase()
    const candidates = entries
      .filter((entry) => extensions.has(path.extname(entry).toLowerCase()))
      .map((entry) => ({
        entry,
        exact: path.basename(entry, path.extname(entry)).toLowerCase() === normalizedBase
      }))

    if (candidates.length === 0) return null
    const match = candidates.find((candidate) => candidate.exact) || candidates[0]
    return path.join(dir, match.entry)
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return null
    throw err
  }
}

const ensureOutputPath = async ({
  searchDirs,
  outputPath,
  baseName,
  verbose,
  workspaceDir,
  originalDocxInfo
}) => {
  for (const dir of searchDirs) {
    const candidate = await findConvertedFile({ dir, baseName, extensions: ALLOWED_LIBRARY_EXTENSIONS })
    if (!candidate) continue

    if (candidate !== outputPath) {
      await fs.copyFile(candidate, outputPath)
      const shouldRemove = isInsideDirectory(workspaceDir, candidate) || (
        originalDocxInfo &&
        candidate === originalDocxInfo.path &&
        !originalDocxInfo.existed
      )

      if (shouldRemove) {
        await fs.rm(candidate, { force: true })
        logVerbose(verbose, `🧽 Removed intermediate converted file at ${candidate}`)
      }
    }

    return true
  }

  return false
}

const runDoc2DocxFunction = async ({
  fn,
  inputPath,
  outputPath,
  baseName,
  searchDirs,
  workspaceDir,
  originalDocxInfo,
  verbose
}) => {
  const signatures = [
    () => fn(inputPath, outputPath),
    () => fn({ input: inputPath, output: outputPath }),
    () => fn({ source: inputPath, destination: outputPath }),
    () => fn(inputPath)
  ]

  for (const invoke of signatures) {
    try {
      const result = invoke()
      if (result && typeof result.then === 'function') await result
      const resolved = await ensureOutputPath({
        searchDirs,
        outputPath,
        baseName,
        verbose,
        workspaceDir,
        originalDocxInfo
      })
      if (resolved) return true
    } catch (err) {
      logVerbose(verbose, `⚠️ doc2docx invocation failed: ${err.message}`)
    }
  }

  return false
}

const convertUsingModule = async ({
  module,
  inputPath,
  outputPath,
  baseName,
  workspaceDir,
  originalDocxInfo,
  verbose
}) => {
  if (!module) return false

  const searchDirs = [path.dirname(outputPath), path.dirname(inputPath)]
  const candidates = []
  if (typeof module === 'function') candidates.push(module)
  if (module && typeof module.convert === 'function') candidates.push(module.convert.bind(module))
  if (module && typeof module.default === 'function') candidates.push(module.default.bind(module))
  if (module && typeof module.doc2docx === 'function') candidates.push(module.doc2docx.bind(module))

  for (const fn of candidates) {
    const success = await runDoc2DocxFunction({
      fn,
      inputPath,
      outputPath,
      baseName,
      searchDirs,
      workspaceDir,
      originalDocxInfo,
      verbose
    })
    if (success) return true
  }

  return false
}

const convertUsingCli = async ({
  filePath,
  tempDir,
  outputPath,
  baseName,
  originalDocxInfo,
  verbose
}) => {
  const inputCopyPath = path.join(tempDir, path.basename(filePath))
  try {
    await fs.copyFile(filePath, inputCopyPath)
  } catch (err) {
    logVerbose(verbose, `⚠️ Unable to prepare temporary input for doc2docx CLI: ${err.message}`)
    return false
  }

  const inputName = path.basename(inputCopyPath)
  const outputName = path.basename(outputPath)
  const attempts = [
    [inputCopyPath, outputPath],
    [inputCopyPath],
    [inputName],
    [inputName, outputName],
    ['--output', outputPath, inputCopyPath],
    ['--output', outputName, inputName],
    [inputCopyPath, '--output', outputPath],
    [inputName, '--output', outputName],
    ['--input', inputCopyPath, '--output', outputPath]
  ]

  const attempted = new Set()
  let conversionSucceeded = false

  for (const args of attempts) {
    const key = args.join('|')
    if (attempted.has(key)) continue
    attempted.add(key)

    try {
      await execFileAsync('doc2docx', args, { cwd: tempDir })
      const resolved = await ensureOutputPath({
        searchDirs: [tempDir],
        outputPath,
        baseName,
        verbose,
        workspaceDir: tempDir,
        originalDocxInfo
      })
      if (resolved) {
        conversionSucceeded = true
        break
      }
    } catch (err) {
      logVerbose(verbose, `⚠️ doc2docx CLI attempt failed (${args.join(' ')}): ${err.message}`)
    }
  }

  try {
    await fs.rm(inputCopyPath, { force: true })
  } catch (err) {
    logVerbose(verbose, `⚠️ Failed to remove temporary copy ${inputCopyPath}: ${err.message}`)
  }

  return conversionSucceeded
}

const convertBinaryOfficeToDocx = async ({ filePath, ext, verbose = false }) => {
  const kind = BINARY_OFFICE_KINDS[ext]
  if (!kind) {
    throw new Error(`Unsupported binary Office extension: ${ext}`)
  }

  const parsedPath = path.parse(filePath)
  const baseName = (parsedPath && parsedPath.name) ? parsedPath.name : 'converted'
  const originalDocxPath = path.join(path.dirname(filePath), `${baseName}.docx`)
  const originalDocxExists = await fileExists(originalDocxPath)
  const originalDocxInfo = { path: originalDocxPath, existed: originalDocxExists }

  logVerbose(verbose, `⚙️ Starting legacy ${kind} conversion for ${path.basename(filePath)}`)

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-renamer-legacy-'))
  let cleaned = false
  const cleanup = async () => {
    if (cleaned) return
    cleaned = true
    await fs.rm(tempDir, { recursive: true, force: true })
    logVerbose(verbose, `🧹 Removed temporary directory ${tempDir}`)
  }

  const tempPath = path.join(tempDir, `${baseName}.docx`)

  if (kind === 'word') {
    const module = await loadDoc2Docx()
    if (module) {
      logVerbose(verbose, '🔧 Attempting doc2docx module conversion')
      const converted = await convertUsingModule({
        module,
        inputPath: filePath,
        outputPath: tempPath,
        baseName,
        workspaceDir: tempDir,
        originalDocxInfo,
        verbose
      })

      if (converted) {
        logVerbose(verbose, `✅ doc2docx module produced ${tempPath}`)
        return { tempPath, cleanup }
      }

      logVerbose(verbose, '⚠️ doc2docx module did not produce a DOCX output, trying CLI fallback')
    } else {
      logVerbose(verbose, 'ℹ️ doc2docx module not available, attempting CLI conversion')
    }

    const cliConverted = await convertUsingCli({
      filePath,
      tempDir,
      outputPath: tempPath,
      baseName,
      originalDocxInfo,
      verbose
    })

    if (cliConverted) {
      logVerbose(verbose, `✅ doc2docx CLI produced ${tempPath}`)
      return { tempPath, cleanup }
    }

    logVerbose(verbose, '⚠️ doc2docx conversion attempts failed, reverting to text extraction fallback')
  }

  const buffer = await fs.readFile(filePath)
  const lines = extractBinaryLines(buffer)

  logVerbose(verbose, `🧵 Extracted ${lines.length} text segment(s) from binary ${kind} file`)

  if (lines.length === 0) {
    await cleanup()
    throw new Error(`No textual content could be extracted from ${path.basename(filePath)}. The file may require manual conversion.`)
  }

  const docxBuffer = buildDocxBuffer(lines)
  await fs.writeFile(tempPath, docxBuffer)
  logVerbose(verbose, `📦 Wrote fallback DOCX to ${tempPath}`)

  return { tempPath, cleanup }
}

module.exports = { convertBinaryOfficeToDocx }
