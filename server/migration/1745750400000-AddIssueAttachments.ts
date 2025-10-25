import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIssueAttachments1745750400000 implements MigrationInterface {
  name = 'AddIssueAttachments1745750400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add attachmentPath column to issue_comment table
    await queryRunner.query(
      `CREATE TABLE "temporary_issue_comment" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "message" text NOT NULL, "attachmentPath" text, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "userId" integer, "issueId" integer, CONSTRAINT "FK_707b033c2d0653f75213614789d" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_180710fead1c94ca499c57a7d42" FOREIGN KEY ("issueId") REFERENCES "issue" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_issue_comment"("id", "message", "createdAt", "updatedAt", "userId", "issueId") SELECT "id", "message", "createdAt", "updatedAt", "userId", "issueId" FROM "issue_comment"`
    );
    await queryRunner.query(`DROP TABLE "issue_comment"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_issue_comment" RENAME TO "issue_comment"`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove attachmentPath column from issue_comment table
    await queryRunner.query(
      `ALTER TABLE "issue_comment" RENAME TO "temporary_issue_comment"`
    );
    await queryRunner.query(
      `CREATE TABLE "issue_comment" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "message" text NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "userId" integer, "issueId" integer, CONSTRAINT "FK_707b033c2d0653f75213614789d" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_180710fead1c94ca499c57a7d42" FOREIGN KEY ("issueId") REFERENCES "issue" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "issue_comment"("id", "message", "createdAt", "updatedAt", "userId", "issueId") SELECT "id", "message", "createdAt", "updatedAt", "userId", "issueId" FROM "temporary_issue_comment"`
    );
    await queryRunner.query(`DROP TABLE "temporary_issue_comment"`);
  }
}
