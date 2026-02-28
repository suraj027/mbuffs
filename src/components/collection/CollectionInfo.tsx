
import React from 'react';
import { CollectionSummary } from '@/lib/types';

interface CollectionInfoProps {
  collection: CollectionSummary;
}

const CollectionInfo: React.FC<CollectionInfoProps> = ({ collection }) => {
  return (
    <div className="bg-card border border-border p-4 rounded-lg">
      <h1 className="text-2xl font-bold text-card-foreground">{collection.name}</h1>
      {collection.description && (
        <p className="text-muted-foreground mt-2">{collection.description}</p>
      )}
      <div className="mt-2 text-sm text-muted-foreground">
        <span>Created by: {collection.owner_username || 'Unknown'}</span>
      </div>
    </div>
  );
};

export default CollectionInfo;
