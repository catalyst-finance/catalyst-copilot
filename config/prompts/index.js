/**
 * Prompts Index
 * Centralized exports for all prompt configurations
 */

const schemaContext = require('./schema-context');
const systemPrompt = require('./system-prompt');

module.exports = {
  // Schema context
  QUERY_SCHEMA_CONTEXT: schemaContext.QUERY_SCHEMA_CONTEXT,
  RESPONSE_SCHEMA_CONTEXT: schemaContext.RESPONSE_SCHEMA_CONTEXT,
  COLLECTION_METADATA: schemaContext.COLLECTION_METADATA,
  getCollectionTitle: schemaContext.getCollectionTitle,
  getCollectionFriendlyName: schemaContext.getCollectionFriendlyName,
  hasExternalContent: schemaContext.hasExternalContent,
  
  // System prompt
  buildSystemPrompt: systemPrompt.buildSystemPrompt
};
