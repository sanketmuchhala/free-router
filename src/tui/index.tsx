import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput } from 'ink';
import { Catalog, ProviderStatus } from '../providers/catalog.js';
import { Health, profileTask, rank, Ranked } from '../routing/rank.js';

interface TUIProps {
  catalog: Catalog;
  health: Health;
  initialStatuses: ProviderStatus[];
}

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
    setSelectedIndex(0);
  };
  
  useEffect(() => {
    refreshRankings();
  }, [taskMode, catalog]);

  const visibleModels = models.slice(0, 15);
  const selectedModel = visibleModels[selectedIndex];

  useInput((input, key) => {
    if (input === 'c') setTaskMode('chat');
    if (input === 'a') setTaskMode('code');
    if (input === 'q') process.exit(0);

    if (key.upArrow) {
      setSelectedIndex(Math.max(0, selectedIndex - 1));
    }
    if (key.downArrow) {
      setSelectedIndex(Math.min(visibleModels.length - 1, selectedIndex + 1));
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1} justifyContent="space-between">
        <Text bold color="cyan">🚀 onerouter</Text>
        <Text color="gray">
          {taskMode === 'chat' ? <Text color="green" bold>[C]hat</Text> : '[C]hat'} |{' '}
          {taskMode === 'code' ? <Text color="green" bold>[A]gents</Text> : '[A]gents'} |{' '}
          [Q]uit
        </Text>
      </Box>

      {/* Middle Section: Providers & Details */}
      <Box marginBottom={1} width="100%">
        {/* Providers */}
        <Box width="50%" flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
          <Box borderBottom={false} marginBottom={1}>
            <Text bold color="magenta">Providers ({statuses.length})</Text>
          </Box>
          {statuses.map(status => (
            <Box key={status.id} justifyContent="space-between">
              <Text color={status.ok ? 'white' : 'red'}>{status.id}</Text>
              <Text color={status.ok ? 'green' : 'red'}>
                {status.ok ? `${status.free}/${status.listed}` : 'Err'}
              </Text>
            </Box>
          ))}
        </Box>

        {/* Details */}
        <Box width="50%" flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginLeft={1}>
          <Box borderBottom={false} marginBottom={1}>
            <Text bold color="magenta">Model Details</Text>
          </Box>
          {selectedModel ? (
            <>
              <Text bold color="white">{selectedModel.model.ref}</Text>
              <Text color="gray">Score: <Text color="yellow">{selectedModel.score.toFixed(2)}</Text></Text>
              <Text color="gray">Context: <Text color="white">{selectedModel.model.contextLength ? `${Math.round(selectedModel.model.contextLength / 1000)}k` : 'Unknown'}</Text></Text>
              <Text color="gray">Price: <Text color={selectedModel.model.price === 'zero-price' ? 'green' : 'white'}>{selectedModel.model.price}</Text></Text>
              <Box marginTop={1} flexDirection="column">
                <Text color="gray">Capabilities:</Text>
                <Text color="white">  Tools: {selectedModel.model.capabilities.tools ? '✅' : '❌'}</Text>
                <Text color="white">  Vision: {selectedModel.model.capabilities.vision ? '✅' : '❌'}</Text>
              </Box>
            </>
          ) : (
            <Text color="gray">No model selected</Text>
          )}
        </Box>
      </Box>

      {/* Table */}
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
        <Box borderBottom={false} marginBottom={1}>
          <Text bold color="yellow">Top Free Models (Best First)</Text>
        </Box>
        
        {/* Table Header */}
        <Box>
          <Box width="3%"><Text dimColor>#</Text></Box>
          <Box width="35%"><Text bold>Model</Text></Box>
          <Box width="10%"><Text bold>Ctx</Text></Box>
          <Box width="10%"><Text bold>Price</Text></Box>
          <Box width="42%"><Text bold>Why</Text></Box>
        </Box>
        
        {/* Table Rows */}
        {visibleModels.map((m, i) => {
          const isSelected = i === selectedIndex;
          const bg = isSelected ? 'cyan' : undefined;
          const fg = isSelected ? 'black' : (i < 3 ? 'green' : 'white');

          return (
            <Box key={m.model.ref} backgroundColor={bg}>
              <Box width="3%">
                <Text color={isSelected ? 'black' : 'gray'}>{i + 1}</Text>
              </Box>
              <Box width="35%">
                <Text color={fg} bold={isSelected}>
                  {m.model.ref.length > 33 ? m.model.ref.slice(0, 31) + '…' : m.model.ref}
                </Text>
              </Box>
              <Box width="10%">
                <Text color={isSelected ? 'black' : 'gray'}>
                  {m.model.contextLength ? `${Math.round(m.model.contextLength / 1000)}k` : '?'}
                </Text>
              </Box>
              <Box width="10%">
                <Text color={isSelected ? 'black' : 'gray'}>
                  {m.model.price === 'zero-price' ? 'free' : m.model.price}
                </Text>
              </Box>
              <Box width="42%">
                <Text color={isSelected ? 'black' : 'gray'} wrap="truncate-end">
                  {m.why.join(', ')}
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

export function startTui(catalog: Catalog, health: Health, statuses: ProviderStatus[]) {
  render(<TUI catalog={catalog} health={health} initialStatuses={statuses} />);
}
