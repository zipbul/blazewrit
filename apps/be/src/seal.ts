// Seal every @bw/dto @Recipe once. baker requires a single argless seal() at startup,
// after all DTOs are imported, before any validate/deserialize/serialize.
import '@bw/dto';
import { seal } from '@zipbul/baker';

seal();
