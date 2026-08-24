'use client';

import { IconArrow } from '@pierre/icons';
import { memo } from 'react';

import { Button } from '@/components/Button';
import { DiffUrlForm } from '@/components/DiffUrlForm';

// Submitting moves to the shareable viewer URL first; the viewer route owns
// fetching and renders its own loading state there.
export const OpenFetchForm = memo(function OpenFetchForm() {
  return (
    <div className="px-4">
      <DiffUrlForm
        placeholder="owner/repo#123, or a URL"
        inputClassName="text-md h-12 w-full text-start"
      >
        {(isPending, url) => (
          <Button
            type="submit"
            variant="ghost"
            size="icon-md"
            disabled={isPending || url.length === 0}
            aria-label={isPending ? 'Fetching…' : 'Fetch'}
            className="hover:text-muted-foreground -mr-2 hover:bg-transparent"
          >
            <IconArrow className="size-4 rotate-180" />
          </Button>
        )}
      </DiffUrlForm>
    </div>
  );
});
