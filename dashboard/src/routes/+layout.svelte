<script lang="ts">
	import './layout.css';
	let { children } = $props();
</script>

<svelte:head>
	<title>Codex CT Agent Dashboard</title>
	<meta name="description" content="Autonomous Coding Agent Dashboard for Proxmox CT" />
</svelte:head>

<div class="min-h-screen bg-zinc-950 text-zinc-100 antialiased font-sans flex flex-col selection:bg-indigo-500/30 selection:text-indigo-200">
	{@render children()}
</div>