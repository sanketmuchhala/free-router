import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput, Spacer } from 'ink';
import { Catalog, ProviderStatus } from '../providers/catalog.js';
import { Health, profileTask, rank, Ranked } from '../routing/rank.js';

interface TUIProps {
  catalog: Catalog;
  health: Health;
  initialStatuses: ProviderStatus[];
  telemetry?: any;
}

const Header = () => (
  <Box flexDirection="row" width="100%" marginBottom={1}>
    <Box flexGrow={1} backgroundColor="blue" paddingX={2}>
      <Text bold color="white">▲ ONE ROUTER</Text>
    </Box>
    <Box backgroundColor="cyan" paddingX={2}>
      <Text color="black" bold>Inference Control Plane</Text>
    </Box>
  </Box>
);

const MetricsRow = ({ statuses, telemetry }: { statuses: ProviderStatus[], telemetry?: any }) => {
  const healthyCount = statuses.filter(s => s.ok).length;
  const isAllHealthy = healthyCount === statuses.length;
  
  return (
    <Box flexDirection="row" width="100%" marginBottom={1} justifyContent="space-between">
      <Box borderStyle="round" borderColor={isAllHealthy ? "green" : "yellow"} paddingX={2} flexGrow={1} marginRight={1}>
        <Text color="gray">HEALTH  </Text>
        <Text bold color={isAllHealthy ? "green" : "yellow"}>{healthyCount}/{statuses.length} ONLINE</Text>
      </Box>
      <Box borderStyle="round" borderColor="gray" paddingX={2} flexGrow={1} marginRight={1}>
        <Text color="gray">RPS  </Text>
        <Text bold color="white">{telemetry ? telemetry.getMetrics().rps.toFixed(1) : "0.0"}</Text>
      </Box>
      <Box borderStyle="round" borderColor="gray" paddingX={2} flexGrow={1} marginRight={1}>
        <Text color="gray">P95  </Text>
        <Text bold color="white">{telemetry ? telemetry.getMetrics().p95.toFixed(0) : 0}<Text color="gray">ms</Text></Text>
      </Box>
      <Box borderStyle="round" borderColor="gray" paddingX={2} flexGrow={1}>
        <Text color="gray">SAVED  </Text>
        <Text bold color="green">${telemetry ? telemetry.getMetrics().saved.toFixed(2) : "0.00"}</Text>
      </Box>
    </Box>
  );
};

const Dashboard = ({ statuses, models, selectedIndex }: { statuses: ProviderStatus[], models: Ranked[], selectedIndex: number }) => {
  const visibleModels = models.slice(0, 15);
  
  return (
    <Box flexDirection="row" width="100%" marginBottom={1}>
      {/* Providers Column */}
      <Box width="30%" flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginRight={1}>
        <Box marginBottom={1} paddingBottom={1} borderBottom={false}>
          <Text bold color="blue">● PROVIDERS</Text>
        </Box>
        {statuses.map(status => (
          <Box key={status.id} justifyContent="space-between" marginBottom={0}>
            <Text color="white">{status.id}</Text>
            <Text color={status.ok ? 'green' : 'red'}>{status.ok ? 'ONLINE' : 'ERROR'}</Text>
          </Box>
        ))}
      </Box>

      {/* Models/Routes Column */}
      <Box width="70%" flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">◆ LIVE ROUTES</Text>
          <Text color="gray"> (Ranked Best to Worst)</Text>
        </Box>
        {visibleModels.map((m, i) => {
          const isSelected = i === selectedIndex;
          const bg = isSelected ? 'blue' : undefined;
          const fg = isSelected ? 'white' : 'white';
          const reasonFg = isSelected ? 'cyan' : 'gray';
          
          return (
            <Box key={m.model.ref} backgroundColor={bg} justifyContent="space-between" paddingX={isSelected ? 1 : 0}>
              <Text color={fg} bold={isSelected} wrap="truncate-end">
                {isSelected ? '› ' : '  '}
                {m.model.ref.length > 40 ? m.model.ref.slice(0, 38) + '…' : m.model.ref}
              </Text>
              <Text color={reasonFg}>
                {m.why[0] || 'balanced'}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

const Traces = () => (
  <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
    <Box marginBottom={1}>
      <Text bold color="magenta">◒ RECENT TRACES</Text>
    </Box>
    <Box justifyContent="space-between">
      <Text color="gray">  Waiting for incoming inference requests...</Text>
    </Box>
  </Box>
);

const TUI: React.FC<TUIProps> = ({ catalog, health, initialStatuses }) => {
  const [taskMode, setTaskMode] = useState<'chat' | 'code'>('chat');
  const [models, setModels] = useState<Ranked[]>([]);
  const [statuses, setStatuses] = useState(initialStatuses);
  const [selectedIndex, setSelectedIndex] = useState(0);
  
  const refreshRankings = () => {
    const task = taskMode === 'chat' 
      ? profileTask([{ role: 'user', content: 'Explain this' }], false)
      : profileTask([{ role: 'user', content: 'Fix it' }], true);
    
    const { ranked } = rank(catalog.models(), task, health);
    setModels(ranked);
  };
  
  useEffect(() => {
    refreshRankings();
  }, [taskMode, catalog]);

  useInput((input, key) => {
    if (input === 'c') setTaskMode('chat');
    if (input === 'a') setTaskMode('code');
    if (input === 'q' || key.escape) process.exit(0);

    const visibleModels = models.slice(0, 15);
    if (key.upArrow) {
      setSelectedIndex(Math.max(0, selectedIndex - 1));
    }
    if (key.downArrow) {
      setSelectedIndex(Math.min(visibleModels.length - 1, selectedIndex + 1));
    }
  });

  return (
    <Box flexDirection="column" padding={1} width={100}>
      <Header />
      <MetricsRow statuses={statuses} telemetry={undefined} />
      <Dashboard statuses={statuses} models={models} selectedIndex={selectedIndex} />
      <Traces />
      <Box marginTop={1} justifyContent="center" flexDirection="row">
        <Text color="gray">MODE: </Text>
        <Text color={taskMode === 'chat' ? "cyan" : "gray"} bold={taskMode === 'chat'}>[C]hat Routes  </Text>
        <Text color={taskMode === 'code' ? "cyan" : "gray"} bold={taskMode === 'code'}>[A]gent Routes  </Text>
        <Text color="gray">   CONTROLS: [↑↓] Navigate   [Q]uit</Text>
      </Box>
    </Box>
  );
};

export function startTui(catalog: Catalog, health: Health, statuses: ProviderStatus[]) {
  render(<TUI catalog={catalog} health={health} initialStatuses={statuses} />);
}
