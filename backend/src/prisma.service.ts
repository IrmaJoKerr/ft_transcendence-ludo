import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { requireSecret } from './secrets';

@Injectable()
// Database connection service. Injected by every service that touches the
// DB (auth, user, friends, match, ...) via `this.prisma.db`.
export class PrismaService implements OnModuleInit, OnModuleDestroy {
	// The live Prisma client over a Postgres connection pool.
	db: InstanceType<typeof PrismaClient>;

	constructor() {
		// LOCAL/DOCKER: PrismaPg adapter for direct Postgres access (Prisma 7).
		// DATABASE_URL comes from env (compose's env_file, overridden to the
		// container host "db"). See backend/prisma.config.ts for details.
		const connectionString = requireSecret('DATABASE_URL');
		const pool = new Pool({ connectionString, max: 5 }); //changes made 23/7 by bing
		const adapter = new PrismaPg(pool); //changes made 23/7 by bing
		this.db = new PrismaClient({
			adapter,
		});
		// // VERCEL alternative:
		// const accelerateUrl = process.env["ACCELERATE_URL"];
		// if (accelerateUrl) {
		// this.db = new PrismaClient({ accelerateUrl });
		// }
	}

	async onModuleInit() {
		await this.db.$connect();
	}

	async onModuleDestroy() {
		await this.db.$disconnect();
	}
}