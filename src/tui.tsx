import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput } from 'ink';
import { Catalog, ProviderStatus } from './catalog.js';
import { Health, profileTask, rank, Ranked } from './rank.js';

interface TUIProps {
  catalog: Catalog;
  health: Health;
  initialStatuses: ProviderStatus[];
}

const TUI: React.FC<TUIProps> = ({ catalog, health, initialStatuses }) => {
  const [taskMode, setTaskMode] = useState<'chat' | 'code'>('chat');
  const [models, setModels] = useState<Ranked[]>([]);
  const [statuses, setStatuses] = useState(initialStatuses);
  
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
    if (input === 'q') process.exit(0);
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1} flexDirection="column">
        <Text bold color="cyan">free-router • {catalog.models().length} models available</Text>
        <Text color="gray">Keys: [c] Chat task | [a] Agents (code) task | [q] Quit</Text>
      </Box>

      <Box marginBottom={1} flexDirection="column">
        <Text bold>Providers:</Text>
        {statuses.map(status => (
          <Box key={status.id}>
            <Text color={status.ok ? 'green' : 'red'}>
              {status.id.padEnd(15)} 
              {status.ok 
                ? `${status.free} free of ${status.listed} models` 
                : `unavailable: ${status.error}`
              }
            </Text>
          </Box>
        ))}
      </Box>

      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color="yellow">
            Ranking for: {taskMode === 'chat' ? 'Chat (General)' : 'Agents with tools (Code)'}
          </Text>
        </Box>
        
        <Box borderStyle="single" flexDirection="column">
          <Box borderBottom={false} paddingX={1}>
            <Box width="45%"><Text bold>Model</Text></Box>
            <Box width="15%"><Text bold>Context</Text></Box>
            <Box width="15%"><Text bold>Price</Text></Box>
            <Box width="25%"><Text bold>Why</Text></Box>
          </Box>
          {models.slice(0, 15).map((m, i) => (
            <Box key={m.model.ref} paddingX={1}>
              <Box width="45%">
                <Text color={i < 3 ? 'green' : undefined}>
                  {m.model.ref.length > 40 ? m.model.ref.slice(0, 38) + '…' : m.model.ref}
                </Text>
              </Box>
              <Box width="15%">
                <Text>{m.model.contextLength ? `${Math.round(m.model.contextLength / 1000)}k` : '?'}</Text>
              </Box>
              <Box width="15%">
                <Text>{m.model.price}</Text>
              </Box>
              <Box width="25%">
                <Text color="gray">{m.why.join(', ').slice(0, 35)}</Text>
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
};

export function startTui(catalog: Catalog, health: Health, statuses: any[]) {
  render(<TUI catalog={catalog} health={health} initialStatuses={statuses} />);
}
