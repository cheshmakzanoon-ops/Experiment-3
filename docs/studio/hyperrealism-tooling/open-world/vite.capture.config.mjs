import base from '/home/user/Experiment-3/.claude/worktrees/agent-a50b2ae0572a7cf9b/vite.config.ts';
export default {
  ...base,
  root: '/home/user/Experiment-3/.claude/worktrees/agent-a50b2ae0572a7cf9b',
  server: { ...(base.server ?? {}), hmr: false },
};
