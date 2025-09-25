const changeCase = require('change-case')

const CASE_FUNCTIONS = {
  camelCase: changeCase.camelCase,
  capitalCase: changeCase.capitalCase,
  constantCase: changeCase.constantCase,
  dotCase: changeCase.dotCase,
  kebabCase: changeCase.kebabCase,
  noCase: changeCase.noCase,
  pascalCase: changeCase.pascalCase,
  pascalSnakeCase: changeCase.pascalSnakeCase,
  pathCase: changeCase.pathCase,
  sentenceCase: changeCase.sentenceCase,
  snakeCase: changeCase.snakeCase,
  trainCase: changeCase.trainCase
}

function applyCase (value, caseStyle) {
  const formatter = CASE_FUNCTIONS[caseStyle] || changeCase.kebabCase
  return formatter(value)
}

module.exports = {
  applyCase,
  CASE_FUNCTIONS
}
