import * as React from 'react';
import { PageBlock } from 'notion-types';

import { CollectionViewProps } from '../types';
import { cs } from '../utils';
import { getCollectionGroups } from './collection-utils';
import { useNotionContext } from '../context';
import { CollectionCard } from './collection-card';
import { CollectionGroup } from './collection-group';

const defaultBlockIds = [];

export const CollectionViewGallery: React.FC<CollectionViewProps> = ({
  collection,
  collectionView,
  collectionData,
}) => {
  const isGroupedCollection = collectionView?.format?.collection_group_by;

  if (isGroupedCollection) {
    const collectionGroups = getCollectionGroups(collection, collectionView, collectionData);

    return collectionGroups.map((group, index) => (
      <CollectionGroup key={index} {...group} collectionViewComponent={Gallery} />
    ));
  }

  const blockIds =
    (collectionData['collection_group_results']?.blockIds ?? collectionData.blockIds) ||
    defaultBlockIds;

  return <Gallery collectionView={collectionView} collection={collection} blockIds={blockIds} />;
};

function Gallery({ blockIds, collectionView, collection }) {
  const { recordMap } = useNotionContext();
  const {
    // 노션 API로 만든 보기는 gallery_cover가 비어 있으므로 기본값을 페이지 커버로 한다
    gallery_cover = { type: 'page_cover' },
    gallery_cover_size = 'medium',
    gallery_cover_aspect = 'cover',
  } = collectionView.format || {};

  return (
    <div className="">
      <div className="postListWrap">
        <div className={'postList'}>
          {blockIds?.map(blockId => {
            const block = recordMap.block[blockId]?.value as PageBlock;
            if (!block) return null;

            return (
              <CollectionCard
                collection={collection}
                block={block}
                cover={gallery_cover}
                coverSize={gallery_cover_size}
                coverAspect={gallery_cover_aspect}
                properties={collectionView.format?.gallery_properties}
                key={blockId}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
