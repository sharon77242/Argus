'use strict';

const { Pool } = require('pg');
const config = require('../config');
const diagnostics_channel = require('diagnostics_channel');
const pool = new Pool(config.db);

const dbChannel = diagnostics_channel.channel('db.query.execution');

/**
 * Query the database using the pool.
 * Also publishes to diagnostics_channel so the ArgusAgent can trace it.
 */
async function query(sql, params) {
    const start = performance.now();
    const {rows} = await pool.query(sql, params);
    const durationMs = performance.now() - start;

    // Broadcast to ArgusAgent
    if (dbChannel.hasSubscribers) {
        dbChannel.publish({ query: sql, durationMs });
    }

    return rows;
}

module.exports = { query };

