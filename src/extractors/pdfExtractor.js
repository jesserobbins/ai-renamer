const fs = require('fs/promises')
const pdfParse = require('pdf-parse')

async function extractPdf (filePath) {
  const buffer = await fs.readFile(filePath)
  const data = await pdfParse(buffer)
  const meta = {
    author: data.info?.Author || '',
    title: data.info?.Title || '',
    pages: data.numpages
  }
  return {
    text: (data.text || '').slice(0, 8000),
    metadata: meta
  }
}

module.exports = {
  extractPdf
}
