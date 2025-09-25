const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const { defaultOptions } = require('../cli/createCli')

const CONFIG_FILE = path.join(os.homedir(), 'ai-renamer.json')
const PERSISTED_KEYS = new Set([
  'provider',
  'apiKey',
  'baseUrl',
  'model',
  'frames',
  'case',
  'chars',
  'language',
  'includeSubdirectories',
  'customPrompt',
  'instructionsFile',
  'subjectStopwords',
  'maxFileSize',
  'onlyExtensions',
  'ignoreExtensions',
  'organizeBySubject',
  'subjectDestination',
  'moveUnknownSubjects'
])

async function loadConfig () {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return { ...defaultOptions, ...parsed }
  } catch (error) {
    return { ...defaultOptions }
  }
}

function filterPersistedOptions (options) {
  const filtered = {}
  for (const key of PERSISTED_KEYS) {
    if (options[key] !== undefined) {
      filtered[key] = options[key]
    }
  }
  return filtered
}

async function saveConfig (config) {
  try {
    const directory = path.dirname(CONFIG_FILE)
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8')
  } catch (error) {
    // Swallow config persistence errors but surface via console
    // eslint-disable-next-line no-console
    console.warn('Unable to persist configuration:', error.message)
  }
}

module.exports = {
  loadConfig,
  saveConfig,
  filterPersistedOptions,
  CONFIG_FILE
}
