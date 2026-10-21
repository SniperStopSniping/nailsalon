'use strict';
const protocol = require('./bootstrap-protocol.json');
const classifyBootstrapFailure = (phase, error) => {
  let errorCode = 'UNKNOWN';
  let sqlState = null;
  let current = error;
  const seen = new Set();
  for (let depth = 0; current && typeof current === 'object' && depth < 4 && !seen.has(current); depth += 1) {
    seen.add(current);
    const code = typeof current.code === 'string' ? current.code : '';
    if (errorCode === 'UNKNOWN' && protocol.errorCodes.includes(code)) errorCode = code;
    if (sqlState === null && (protocol.sqlStates.includes(code) || /^[0-9][A-Z0-9]{4}$/.test(code))) {
      sqlState = protocol.sqlStates.includes(code) ? code : 'OTHER_SQLSTATE';
      if (errorCode === 'UNKNOWN') errorCode = 'POSTGRES_ERROR';
    }
    current = current.cause;
  }
  return { status: 'failed', phase: protocol.phases.includes(phase) ? phase : 'UNREPORTED', errorCode, sqlState };
};
module.exports = { classifyBootstrapFailure };
