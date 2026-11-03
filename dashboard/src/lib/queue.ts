import Redis from 'ioredis';
import fs from 'fs';
import path from 'path';
import type { TaskJobData, TaskJobStatus, TaskRecord } from './types';
import { executeTaskPipeline } from './taskRunner';

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;

let redisClient: Redis | null = null;
let redisSub: Redis | null = null;
let redisWorker: Redis | null = null;
let isWorkerRunning = false;

// Active lease heartbeats keyed by taskId
const leaseHeartbeats = new Map<string, NodeJS.Timeout>();

export function getRedisClient(): Redis {
	if (!redisClient) {
		redisClient = new Redis({
			host: REDIS_HOST,
			port: REDIS_PORT,
			maxRetriesPerRequest: 3,
			lazyConnect: false,
			retryStrategy(times) {
				return Math.min(times * 100, 3000);
			}
		});
		redisClient.on('error', (err) => {
			console.warn('[Redis Client Warning]:', err.message);
		});
	}
	return redisClient;
}

export function getRedisSubscriber(): Redis {
	if (!redisSub) {
		redisSub = new Redis({
			host: REDIS_HOST,
			port: REDIS_PORT,
			maxRetriesPerRequest: null,
			lazyConnect: false,
			retryStrategy(times) {
				return Math.min(times * 100, 3000);
			}
		});
		redisSub.on('error', (err) => {
			console.warn('[Redis Subscriber Warning]:', err.message);
		});
	}
	return redisSub;
}

/**
 * Dedicated Redis client for the background worker's blocking BRPOP loop.
 * Prevents blocking connection contention with web API requests and lease checks.
 */
export function getRedisWorkerClient(): Redis {
	if (!redisWorker) {
		redisWorker = new Redis({
			host: REDIS_HOST,
			port: REDIS_PORT,
			maxRetriesPerRequest: null,
			lazyConnect: false,
			retryStrategy(times) {
				return Math.min(times * 100, 3000);
			}
		});
		redisWorker.on('error', (err) => {
			console.warn('[Redis Worker Client Warning]:', err.message);
		});
	}
	return redisWorker;
}

export async function isRedisConnected(): Promise<boolean> {
	try {
		const redis = getRedisClient();
		const pong = await redis.ping();
		return pong === 'PONG';
	} catch {
		return false;
	}
}

// Workspace Lease (Concurrency Guard)
export async function acquireWorkspaceLease(workspace: string, taskId: string, ttlSec = 900): Promise<boolean> {
	if (!workspace || workspace === 'all' || workspace === 'auto-temp' || workspace === 'temp') return true;
	try {
		const redis = getRedisClient();
		const key = `workspace:lease:${workspace}`;
		const res = await redis.set(key, taskId, 'EX', ttlSec, 'NX');
		return res === 'OK';
	} catch (e) {
		console.warn('[Workspace Lease Warning]:', e);
		return true;
	}
}

/**
 * Periodically renews the lease TTL in Redis while a task is actively running.
 * Prevents lease expiration during long-running consensus or complex workflows.
 */
export function startLeaseHeartbeat(workspace: string, taskId: string, ttlSec = 900) {
	if (!workspace || workspace === 'all' || workspace === 'auto-temp' || workspace === 'temp') return;
	stopLeaseHeartbeat(taskId);

	const interval = setInterval(async () => {
		try {
			const redis = getRedisClient();
			const key = `workspace:lease:${workspace}`;
			const lua = `
				if redis.call("get", KEYS[1]) == ARGV[1] then
					return redis.call("expire", KEYS[1], ARGV[2])
				else
					return 0
				end
			`;
			await redis.eval(lua, 1, key, taskId, ttlSec);
		} catch (e) {
			console.warn(`[Lease Heartbeat Warning] Failed to renew lease for ${workspace}:`, e);
		}
	}, 30000); // Heartbeat every 30s

	leaseHeartbeats.set(taskId, interval);
}

export function stopLeaseHeartbeat(taskId: string) {
	const timer = leaseHeartbeats.get(taskId);
	if (timer) {
		clearInterval(timer);
		leaseHeartbeats.delete(taskId);
	}
}

export async function releaseWorkspaceLease(workspace: string, taskId?: string): Promise<void> {
	if (!workspace || workspace === 'all' || workspace === 'auto-temp' || workspace === 'temp') return;
	try {
		const redis = getRedisClient();
		const key = `workspace:lease:${workspace}`;
		if (!taskId) {
			await redis.del(key);
			return;
		}
		const lua = `
			if redis.call("get", KEYS[1]) == ARGV[1] then
				return redis.call("del", KEYS[1])
			else
				return 0
			end
		`;
		await redis.eval(lua, 1, key, taskId);
	} catch (e) {
		console.warn('[Release Lease Warning]:', e);
	}
}

export async function isWorkspaceLocked(workspace: string): Promise<{ locked: boolean; taskId?: string }> {
	if (!workspace || workspace === 'all' || workspace === 'auto-temp' || workspace === 'temp') {
		return { locked: false };
	}
	try {
		const redis = getRedisClient();
		const key = `workspace:lease:${workspace}`;
		const holder = await redis.get(key);
		if (holder) {
			return { locked: true, taskId: holder };
		}
		return { locked: false };
	} catch {
		return { locked: false };
	}
}

// SSE Real-time Event Publishing
export async function publishTaskEvent(taskId: string, event: Record<string, any>): Promise<void> {
	try {
		const redis = getRedisClient();
		const channel = `task:events:${taskId}`;
		const payload = JSON.stringify({ taskId, timestamp: Date.now(), ...event });
		await redis.publish(channel, payload);
	} catch (e) {
		console.warn('[Publish Event Warning]:', e);
	}
}

// Enqueue Task into Redis
export async function enqueueTask(data: {
	workspace: string;
	prompt: string;
	provider: string;
	branch?: string;
}): Promise<TaskJobData> {
	const id = `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
	const jobData: TaskJobData = {
		id,
		workspace: data.workspace,
		prompt: data.prompt,
		provider: data.provider,
		branch: data.branch,
		status: 'queued',
		createdAt: Date.now()
	};

	try {
		const redis = getRedisClient();
		await redis.hset(`task:${id}`, {
			id,
			data: JSON.stringify(jobData),
			status: 'queued',
			createdAt: jobData.createdAt.toString()
		});
		await redis.expire(`task:${id}`, 86400); // 24hr TTL

		// Push to list queue
		await redis.lpush('tasks:queue', id);
		await publishTaskEvent(id, { type: 'status', status: 'queued', message: 'Task queued in Redis' });
	} catch (e) {
		console.warn('[Redis Queue Fallback Warning]:', e);
	}

	return jobData;
}

// Retrieve Task Status & Details
export async function getTask(taskId: string): Promise<TaskJobData | null> {
	try {
		const redis = getRedisClient();
		const raw = await redis.hget(`task:${taskId}`, 'data');
		if (raw) {
			return JSON.parse(raw);
		}
	} catch (e) {}

	// Fallback to tasks_history.json
	try {
		const historyFile = fs.existsSync('/opt/agent-bridge')
			? '/opt/agent-bridge/tasks_history.json'
			: path.resolve('tasks_history.json');
		if (fs.existsSync(historyFile)) {
			const history: TaskRecord[] = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
			const found = history.find(h => h.id === taskId);
			if (found) {
				return {
					id: found.id,
					workspace: found.workspace,
					prompt: found.prompt,
					provider: found.provider,
					branch: found.branch,
					status: (found.jobStatus || 'completed') as TaskJobStatus,
					result: found,
					testEvidence: found.testEvidence,
					createdAt: found.timestamp
				};
			}
		}
	} catch (e) {}

	return null;
}

/**
 * Scans tasks:processing for tasks left behind by an unexpected crash or container reboot.
 * Reconciles their status to 'failed' and clears them from tasks:processing.
 */
export async function recoverOrphanedTasks() {
	try {
		const redis = getRedisClient();
		const processingTasks = await redis.lrange('tasks:processing', 0, -1);
		if (processingTasks && processingTasks.length > 0) {
			console.log(`[Redis Job Queue] Found ${processingTasks.length} in-flight tasks from prior session. Cleaning up...`);
			for (const taskId of processingTasks) {
				const raw = await redis.hget(`task:${taskId}`, 'data');
				if (raw) {
					try {
						const job: TaskJobData = JSON.parse(raw);
						if (job.status === 'running' || job.status === 'queued') {
							job.status = 'failed';
							job.error = 'Task interrupted by bridge restart or container reboot';
							job.completedAt = Date.now();
							await redis.hset(`task:${taskId}`, {
								status: 'failed',
								data: JSON.stringify(job)
							});
						}
					} catch (e) {}
				}
				await redis.lrem('tasks:processing', 1, taskId);
			}
			console.log('[Redis Job Queue] In-flight task recovery complete.');
		}
	} catch (e) {
		console.warn('[Redis Recovery Warning]:', e);
	}
}

// Redis Job Queue Background Worker
export function startTaskWorker() {
	if (isWorkerRunning) return;
	isWorkerRunning = true;
	console.log('[Redis Job Queue] Dedicated Worker started. Monitoring tasks:queue...');

	(async () => {
		// Reconcile and recover any tasks left in tasks:processing from prior session
		await recoverOrphanedTasks();

		const workerClient = getRedisWorkerClient();
		const redis = getRedisClient();

		while (isWorkerRunning) {
			try {
				// Atomic queue transition: brpoplpush safely moves taskId from queue to processing list
				const taskId = await workerClient.brpoplpush('tasks:queue', 'tasks:processing', 3);
				if (!taskId) continue;

				const rawData = await redis.hget(`task:${taskId}`, 'data');
				if (!rawData) {
					await redis.lrem('tasks:processing', 1, taskId);
					continue;
				}

				const job: TaskJobData = JSON.parse(rawData);
				console.log(`[Redis Job Queue] Worker picked up task ${taskId} (workspace: ${job.workspace}, provider: ${job.provider})`);

				job.status = 'running';
				job.startedAt = Date.now();
				await redis.hset(`task:${taskId}`, {
					status: 'running',
					data: JSON.stringify(job)
				});
				await publishTaskEvent(taskId, { type: 'status', status: 'running', message: 'Worker started processing' });

				// Acquire Workspace Lease and start Heartbeat renewal
				await acquireWorkspaceLease(job.workspace, taskId, 900);
				startLeaseHeartbeat(job.workspace, taskId, 900);

				try {
					// Run Pipeline with Event Streaming
					const result = await executeTaskPipeline(job, async (event) => {
						if (event.type === 'stage') job.stage = event.stage;
						await publishTaskEvent(taskId, event);
					});

					job.status = 'completed';
					job.completedAt = Date.now();
					job.result = result;
					job.testEvidence = result.testEvidence;

					await redis.hset(`task:${taskId}`, {
						status: 'completed',
						data: JSON.stringify(job)
					});

					await publishTaskEvent(taskId, {
						type: 'done',
						status: 'completed',
						result,
						testEvidence: result.testEvidence
					});
					console.log(`[Redis Job Queue] Task ${taskId} successfully completed.`);
				} catch (taskErr: any) {
					console.error(`[Redis Job Queue] Task ${taskId} failed:`, taskErr.message);
					job.status = 'failed';
					job.error = taskErr.message;
					job.completedAt = Date.now();

					await redis.hset(`task:${taskId}`, {
						status: 'failed',
						data: JSON.stringify(job)
					});

					await publishTaskEvent(taskId, {
						type: 'error',
						status: 'failed',
						error: taskErr.message
					});
				} finally {
					// Stop Heartbeat renewal and release Workspace Lease
					stopLeaseHeartbeat(taskId);
					await releaseWorkspaceLease(job.workspace, taskId);
					await redis.lrem('tasks:processing', 1, taskId);
				}
			} catch (err: any) {
				// Prevent tight error loop if Redis disconnects
				await new Promise(r => setTimeout(r, 2000));
			}
		}
	})();
}
