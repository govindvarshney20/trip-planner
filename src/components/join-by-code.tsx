'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Input } from './ui';

export function JoinByCode() {
  const router = useRouter();
  const [code, setCode] = useState('');

  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = code.trim();
        if (trimmed) router.push(`/t/${encodeURIComponent(trimmed.toUpperCase())}`);
      }}
    >
      <Input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="MISTY-KARST-472"
        aria-label="Trip join code"
        autoCapitalize="characters"
        spellCheck={false}
      />
      <Button type="submit" variant="outline" disabled={!code.trim()}>
        Go
      </Button>
    </form>
  );
}
