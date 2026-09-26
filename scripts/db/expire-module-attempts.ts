/** Run from an authorized scheduler after the module migrations are deployed.
 * No student data is printed. Without --run this is a non-connecting dry run. */
import { expireDueStudentAttempts } from '../../lib/db/moduleAttempts';

if (!process.argv.includes('--run')) {
  console.log('Dry run only. Pass --run to finalize due attempts on the configured database.');
} else {
  let total = 0;
  for (let batch = 0; batch < 100; batch += 1) {
    const count = await expireDueStudentAttempts(25);
    total += count;
    if (count < 25) break;
  }
  console.log(`Finalized ${total} due module attempt(s).`);
}
