import { fileURLToPath } from 'node:url';

/** Same relative depth from src/catalog and dist/catalog. */
export const RAW_DIR = fileURLToPath(new URL('../../data/srd-5.2.1/raw/', import.meta.url));
