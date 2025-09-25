function createSummary () {
  const renamed = []
  const moved = []
  const skipped = []
  const errors = []

  return {
    addRename (entry) {
      renamed.push(entry)
    },
    addMove (entry) {
      moved.push(entry)
    },
    addSkip (entry) {
      skipped.push(entry)
    },
    addError (entry) {
      errors.push(entry)
    },
    print (logger) {
      logger.info('--- Run Summary ---')
      logger.info(`Renamed: ${renamed.length}`)
      renamed.forEach(item => {
        logger.info(`  ${item.original} -> ${item.newName}`)
      })
      if (moved.length) {
        logger.info(`Moved: ${moved.length}`)
        moved.forEach(item => {
          logger.info(`  ${item.file} -> ${item.destination}`)
        })
      }
      if (skipped.length) {
        logger.info(`Skipped: ${skipped.length}`)
        skipped.forEach(item => {
          logger.info(`  ${item.file} (${item.reason})`)
        })
      }
      if (errors.length) {
        logger.error(`Errors: ${errors.length}`)
        errors.forEach(item => {
          logger.error(`  ${item.file}: ${item.error}`)
        })
      }
    },
    export () {
      return { renamed, moved, skipped, errors }
    }
  }
}

module.exports = {
  createSummary
}
