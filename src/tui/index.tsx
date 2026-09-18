import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput } from 'ink';
import { Catalog, ProviderStatus } from '../providers/catalog.js';
import { Health, profileTask, rank, Ranked } from '../routing/rank.js';

interface TUIProps {
  catalog: Catalog;
  health: Health;
  initialStatuses: ProviderStatus[];
}

const Header = () => (
  <Box flexDirection="column" alignItems="center" marginBottom={1}>
    <Text bold color="cyan">O N E   R O U T E R</Text>
    <Text color="gray">inference control plane</Text>
  </Box>
);

const MetricsRow = ({ statuses }: { statuses: ProviderStatus[] }) => {
  const healthyCount = statuses.filter(s => s.ok).length;
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={2} justifyContent="space-between" marginBottom={1}>
      <Text><Text color="gray">HEALTH</Text>  <Text color="green">{healthyCount}/{statuses.length}</Text></Text>
      <Text><Text color="gray">RPS</Text>     <Text color="cyan">0.0</Text></Text>
      <Text><Text color="gray">P95</Text>     <Text color="cyan">0ms</Text></Text>
      <Text><Text color="gray">SAVED</Text>   <Text color="cyan">$0.00</Text></Text>
    </Box>
  );
};

const Dashboard = ({ statuses, models, selectedIndex }: { statuses: ProviderStatus[], models: Ranked[], selectedIndex: number }) => {
  const visibleModels = models.slice(0, 15);
  
  return (
    <Box flexDirection="row" width="100%" marginBottom={1}>
      {/* Providers Column */}
      <Box width="30%" flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginRight={1}>
        <Box marginBottom={1}>
          <Text color="gray" bold>PROVIDERS</Text>
        </Box>
        {statuses.map(status => (
          <Box key={status.id} justifyContent="space-between">
            <Text color="white">{status.id}</Text>
            <Text color={status.ok ? 'green' : 'red'}>{status.ok ? '●' : '○'}</Text>
          </Box>
        ))}
      </Box>

      {/* Models/Routes Column */}
      <Box width="70%" flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
        <Box marginBottom={1}>
          <Text color="gray" bold>LIVE ROUTES (Best First)</Text>
        </Box>
        {visibleModels.map((m, i) => {
          const isSelected = i === selectedIndex;
          const bg = isSelected ? 'cyan' : undefined;
          const fg = isSelected ? 'black' : 'white';
          
          return (
            <Box key={m.model.ref} backgroundColor={bg} justifyContent="space-between">
              <Text color={fg} wrap="truncate-end">
                {m.model.ref.length > 35 ? m.model.ref.slice(0, 33) + '…' : m.model.ref}
              </Text>
              <Text color={isSelected ? 'black' : 'gray'}>
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
  <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
    <Box marginBottom={1}>
      <Text color="gray" bold>RECENT TRACES</Text>
    </Box>
    <Box justifyContent="space-between">
      <Text color="gray">Waiting for requests...</Text>
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
    <Box flexDirection="column" padding={1} width={80}>
      <Header />
      <MetricsRow statuses={statuses} />
      <Dashboard statuses={statuses} models={models} selectedIndex={selectedIndex} />
      <Traces />
      <Box marginTop={1} justifyContent="center">
        <Text color="gray">[↑↓] Navigate   [C]hat/[A]gent routes   [Q]uit</Text>
      </Box>
    </Box>
  );
};

export function startTui(catalog: Catalog, health: Health, statuses: ProviderStatus[]) {
  render(<TUI catalog={catalog} health={health} initialStatuses={statuses} />);
}
