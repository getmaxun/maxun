import sequelize from '../storage/db';
import '../models/User';
import '../models/Robot';
import '../models/Run';
import '../models/RecorderDraft';
import '../models/ResourceClaim';
import '../models/ControlLease';
import '../models/ControlCommand';

/**
 * Establishes the model baseline before legacy migrations run. Maxun's
 * historical migration chain starts from an existing core schema rather than
 * a blank database; this step makes a truly fresh container deterministic.
 */
async function main(): Promise<void> {
  await sequelize.authenticate();
  await sequelize.sync({ force: false, alter: false });
  await sequelize.close();
  console.log('Base model schema prepared successfully.');
}

void main().catch(async error => {
  console.error('Failed to prepare base model schema:', error);
  await sequelize.close().catch(() => undefined);
  process.exitCode = 1;
});
