import { Block } from 'notion-types';
import { defaultMapImageUrl } from 'react-notion-x';

import { defaultPageIcon, defaultPageCover } from './config';
import { NOTION_FILE_PATH } from './notion-file-url';

export const mapImageUrl = (url: string, block: Block) => {
  if (url?.startsWith(`${NOTION_FILE_PATH}?`)) return url;
  if (url === defaultPageCover || url === defaultPageIcon) {
    return url;
  }

  return defaultMapImageUrl(url, block);
};
