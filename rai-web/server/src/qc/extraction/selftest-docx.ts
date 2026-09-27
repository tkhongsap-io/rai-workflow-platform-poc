// W4-05c (W4b plan section 2, readiness): the embedded synthetic DOCX the extractor's `selfTest()` reads. A stored
// ZIP of two parts ([Content_Types].xml and word/document.xml) holding one paragraph of synthetic text; 515 bytes, so
// it fits any configured byte cap. client.test.ts rebuilds it from `selfTestEntries` in worker/ooxml.test-helper.ts
// and checks the bytes match, so the constant is reproducible. No real document; no personal data.
import { Buffer } from 'node:buffer';

export const SELF_TEST_TEXT = 'RAI-DESK-SYNTHETIC-FIXTURE extractor self-test';

export const SELF_TEST_DOCX: Uint8Array = Uint8Array.from(
  Buffer.from(
    'UEsDBBQAAAAAAAAAIVx9j8M5TQAAAE0AAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbDxUeXBlcyB4bWxucz0iaHR0cDovL3NjaGVtYXMub3Bl' +
      'bnhtbGZvcm1hdHMub3JnL3BhY2thZ2UvMjAwNi9jb250ZW50LXR5cGVzIi8+UEsDBBQAAAAAAAAAIVwWCPEVwAAAAMAAAAARAAAAd29yZC9k' +
      'b2N1bWVudC54bWw8dzpkb2N1bWVudCB4bWxuczp3PSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvd29yZHByb2Nlc3Npbmdt' +
      'bC8yMDA2L21haW4iPjx3OmJvZHk+PHc6cD48dzpyPjx3OnQ+UkFJLURFU0stU1lOVEhFVElDLUZJWFRVUkUgZXh0cmFjdG9yIHNlbGYtdGVz' +
      'dDwvdzp0PjwvdzpyPjwvdzpwPjwvdzpib2R5Pjwvdzpkb2N1bWVudD5QSwECFAAUAAAAAAAAACFcfY/DOU0AAABNAAAAEwAAAAAAAAAAAAAA' +
      'AAAAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUABQAAAAAAAAAIVwWCPEVwAAAAMAAAAARAAAAAAAAAAAAAAAAAH4AAAB3b3JkL2RvY3Vt' +
      'ZW50LnhtbFBLBQYAAAAAAgACAIAAAABtAQAAAAA=',
    'base64',
  ),
);
