import type webpack from 'webpack'
import { getModuleBuildInfo } from '../get-module-build-info'
import { WEBPACK_RESOURCE_QUERIES } from '../../../../lib/constants'
import { stringifyRequest } from '../../stringify-request'

export type EdgeSSRLoaderQuery = {
  absolute500Path: string
  absoluteAppPath: string
  absoluteDocumentPath: string
  absoluteErrorPath: string
  absolutePagePath: string
  buildId: string
  dev: boolean
  isServerComponent: boolean
  page: string
  stringifiedConfig: string
  appDirLoader?: string
  pagesType: 'app' | 'pages' | 'root'
  sriEnabled: boolean
  incrementalCacheHandlerPath?: string
  preferredRegion: string | string[] | undefined
}

/*
For pages SSR'd at the edge, we bundle them with the ESM version of Next in order to
benefit from the better tree-shaking and thus, smaller bundle sizes.

The absolute paths for _app, _error and _document, used in this loader, link to the regular CJS modules.
They are generated in `createPagesMapping` where we don't have access to `isEdgeRuntime`,
so we have to do it here. It's not that bad because it keeps all references to ESM modules magic in this place.
*/
function swapDistFolderWithEsmDistFolder(path: string) {
  return path.replace('next/dist/pages', 'next/dist/esm/pages')
}

const edgeSSRLoader: webpack.LoaderDefinitionFunction<EdgeSSRLoaderQuery> =
  async function edgeSSRLoader(this) {
    const {
      dev,
      page,
      buildId,
      absolutePagePath,
      absoluteAppPath,
      absoluteDocumentPath,
      absolute500Path,
      absoluteErrorPath,
      isServerComponent,
      stringifiedConfig: stringifiedConfigBase64,
      appDirLoader: appDirLoaderBase64,
      pagesType,
      sriEnabled,
      incrementalCacheHandlerPath,
      preferredRegion,
    } = this.getOptions()

    const stringifiedConfig = Buffer.from(
      stringifiedConfigBase64 || '',
      'base64'
    ).toString()
    const appDirLoader = Buffer.from(
      appDirLoaderBase64 || '',
      'base64'
    ).toString()
    const isAppDir = pagesType === 'app'

    const buildInfo = getModuleBuildInfo(this._module as any)
    buildInfo.nextEdgeSSR = {
      // @ts-expect-error === 'true' is correct because loader options are serialized as searchParams. Type needs to be fixed somehow.
      isServerComponent: isServerComponent === 'true',
      page: page,
      isAppDir,
    }
    buildInfo.route = {
      page,
      absolutePagePath,
      preferredRegion,
    }

    const stringifiedPagePath = stringifyRequest(this, absolutePagePath)
    const stringifiedAppPath = stringifyRequest(
      this,
      swapDistFolderWithEsmDistFolder(absoluteAppPath)
    )
    const stringifiedErrorPath = stringifyRequest(
      this,
      swapDistFolderWithEsmDistFolder(absoluteErrorPath)
    )
    const stringifiedDocumentPath = stringifyRequest(
      this,
      swapDistFolderWithEsmDistFolder(absoluteDocumentPath)
    )
    const stringified500Path = absolute500Path
      ? stringifyRequest(this, absolute500Path)
      : null

    const pageModPath = `${appDirLoader}${stringifiedPagePath.substring(
      1,
      stringifiedPagePath.length - 1
    )}${isAppDir ? `?${WEBPACK_RESOURCE_QUERIES.edgeSSREntry}` : ''}`

    const transformed = `
    import { adapter, enhanceGlobals } from 'next/dist/esm/server/web/adapter'
    import { getRender } from 'next/dist/esm/build/webpack/loaders/next-edge-ssr-loader/render'
    import { IncrementalCache } from 'next/dist/esm/server/lib/incremental-cache'

    enhanceGlobals()

    const pagesType = ${JSON.stringify(pagesType)}
    ${
      isAppDir
        ? `
      import { renderToHTMLOrFlight as appRenderToHTML } from 'next/dist/esm/server/app-render/app-render'
      import * as pageMod from ${JSON.stringify(pageModPath)}
      const Document = null
      const pagesRenderToHTML = null
      const appMod = null
      const errorMod = null
      const error500Mod = null
    `
        : `
      import Document from ${stringifiedDocumentPath}
      import { renderToHTML as pagesRenderToHTML } from 'next/dist/esm/server/render'
      import * as pageMod from ${stringifiedPagePath}
      import * as appMod from ${stringifiedAppPath}
      import * as errorMod from ${stringifiedErrorPath}
      ${
        stringified500Path
          ? `import * as error500Mod from ${stringified500Path}`
          : `const error500Mod = null`
      }
      const appRenderToHTML = null
    `
    }

    const incrementalCacheHandler = ${
      incrementalCacheHandlerPath
        ? `require("${incrementalCacheHandlerPath}")`
        : 'null'
    }

    const buildManifest = self.__BUILD_MANIFEST
    const prerenderManifest = self.__PRERENDER_MANIFEST
    const reactLoadableManifest = self.__REACT_LOADABLE_MANIFEST
    const rscManifest = self.__RSC_MANIFEST
    const rscCssManifest = self.__RSC_CSS_MANIFEST
    const rscServerManifest = self.__RSC_SERVER_MANIFEST
    const subresourceIntegrityManifest = ${
      sriEnabled ? 'self.__SUBRESOURCE_INTEGRITY_MANIFEST' : 'undefined'
    }
    const nextFontManifest = self.__NEXT_FONT_MANIFEST

    const render = getRender({
      pagesType,
      dev: ${dev},
      page: ${JSON.stringify(page)},
      appMod,
      pageMod,
      errorMod,
      error500Mod,
      Document,
      buildManifest,
      isAppPath: ${!!isAppDir},
      prerenderManifest,
      appRenderToHTML,
      pagesRenderToHTML,
      reactLoadableManifest,
      clientReferenceManifest: ${isServerComponent} ? rscManifest : null,
      serverCSSManifest: ${isServerComponent} ? rscCssManifest : null,
      serverActionsManifest: ${isServerComponent} ? rscServerManifest : null,
      subresourceIntegrityManifest,
      config: ${stringifiedConfig},
      buildId: ${JSON.stringify(buildId)},
      nextFontManifest,
      incrementalCacheHandler,
    })

    export const ComponentMod = pageMod

    export default function(opts) {
      return adapter({
        ...opts,
        IncrementalCache,
        handler: render
      })
    }`

    return transformed
  }
export default edgeSSRLoader
