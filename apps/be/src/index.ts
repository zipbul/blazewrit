import './seal';
import { composeA2A } from './a2a/compose';

const port = Number(process.env.PORT ?? 3000);

composeA2A().listen(port);

console.log(`A2A transport listening on :${port}`);
