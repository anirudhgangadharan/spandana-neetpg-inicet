import { withUserTransaction } from './transactionClient';

export interface AccountDeletionResult {
  readonly deleted: boolean;
  readonly ownedModulesDeleted: number;
}

/**
 * Irreversibly removes one account and all data linked to it.
 *
 * Faculty-owned modules are deleted first because their ownership FK is
 * deliberately restrictive. Cascades then remove snapshots, opens, attempts,
 * responses, and analytics inputs belonging to those modules. Finally the user
 * cascade removes the account's ordinary practice and student-attempt data.
 */
export async function deleteAccount(userId: string, confirmedEmail: string): Promise<AccountDeletionResult> {
  return withUserTransaction(async (client) => {
    const account = await client.query<{ email: string }>(
      'select email from users where id = $1::uuid for update', [userId]
    );
    const email = account.rows[0]?.email;
    if (!email || email.toLowerCase() !== confirmedEmail.trim().toLowerCase()) {
      return { deleted: false, ownedModulesDeleted: 0 };
    }
    const guestUsers = await client.query<{ student_user_id: string }>(
      `select gp.student_user_id from guest_module_participants gp
       join faculty_modules fm on fm.id = gp.module_id where fm.owner_user_id = $1::uuid`, [userId]
    );
    const modules = await client.query(
      'delete from faculty_modules where owner_user_id = $1::uuid', [userId]
    );
    if (guestUsers.rows.length > 0) {
      await client.query('delete from users where id = any($1::uuid[])',
        [guestUsers.rows.map((row) => row.student_user_id)]);
    }
    // A faculty access email is personal administrative data. Deletion frees
    // the slot and requires an explicit new grant if this person returns.
    await client.query(
      'delete from faculty_grants where user_id = $1::uuid or email = $2', [userId, email.toLowerCase()]
    );
    const user = await client.query('delete from users where id = $1::uuid', [userId]);
    return { deleted: (user.rowCount ?? 0) === 1, ownedModulesDeleted: modules.rowCount ?? 0 };
  });
}
