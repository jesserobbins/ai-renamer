#!/usr/bin/env node

const path = require('path')
const process = require('process')

const { createCli } = require('./cli/createCli')
const { loadConfig, saveConfig, filterPersistedOptions } = require('./config/configStore')
const { runRenamer } = require('./core/runRenamer')
const { buildLogger } = require('./utils/logger')

async function main () {
  const logger = buildLogger()
  const config = await loadConfig()
  const cli = createCli(config)

  let argv
  try {
    argv = await cli.parseAsync()
  } catch (error) {
    logger.error(error.message)
    process.exitCode = 1
    return
  }

  const targetPath = argv._[0]
  if (!targetPath) {
    cli.showHelp()
    process.exitCode = 1
    return
  }

  const resolvedTargetPath = path.resolve(process.cwd(), targetPath)

  const effectiveOptions = { ...config, ...argv }
  delete effectiveOptions._
  delete effectiveOptions.$0

  const persistedOptions = filterPersistedOptions(effectiveOptions)
  await saveConfig(persistedOptions)

  try {
    await runRenamer(resolvedTargetPath, effectiveOptions, logger)
  } catch (error) {
    logger.error(error.message)
    if (error.stack) {
      logger.debug(error.stack)
    }
    process.exitCode = 1
  }
}

main()
