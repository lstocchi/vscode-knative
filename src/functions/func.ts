/* eslint-disable import/no-cycle */
/*-----------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat, Inc. All rights reserved.
 *  Licensed under the MIT License. See LICENSE file in the project root for license information.
 *-----------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { TreeItemCollapsibleState, Uri, workspace } from 'vscode';
import * as fs from 'fs-extra';
import * as yaml from 'js-yaml';
import { activeNamespace } from './active-namespace';
import { getFunctionInfo } from './func-info';
import { FunctionNode, FunctionNodeImpl } from './function-tree-view/functionsTreeItem';
import { FuncContent, FunctionList } from './function-type';
import { functionExplorer } from './functionsExplorer';
import { CliExitData } from '../cli/cmdCli';
import { FunctionContextType, FunctionStatus } from '../cli/config';
import { knExecutor } from '../cli/execute';
import { FuncAPI } from '../cli/func-api';

export interface Func {
  getFunctionNodes(): Promise<FunctionNode[]>;
  getTreeFunction(func: FunctionNode): Promise<FunctionNode[]>;
  getDeployedFunction(func: FunctionNode): Promise<Map<string, FunctionNode>>;
  getLocalFunction(func: FunctionNode, functionTreeView: Map<string, FunctionNode>): Promise<FunctionNode[]>;
}

export class FuncImpl implements Func {
  public static ROOT: FunctionNode = new FunctionNodeImpl(undefined, 'root', undefined, undefined);

  async getFunctionNodes(): Promise<FunctionNode[]> {
    // eslint-disable-next-line no-return-await
    return await this._getFunctionsNodes();
  }

  public async _getFunctionsNodes(): Promise<FunctionNode[]> {
    const functionsTree: FunctionNode[] = [];
    const currentNamespace: string = await activeNamespace();
    let functionsNode: FunctionNode;
    if (!currentNamespace) {
      functionsNode = new FunctionNodeImpl(
        FuncImpl.ROOT,
        'default',
        FunctionContextType.FAILNAMESPACENODE,
        this,
        TreeItemCollapsibleState.Collapsed,
      );
    } else {
      functionsNode = new FunctionNodeImpl(
        FuncImpl.ROOT,
        currentNamespace,
        FunctionContextType.NAMESPACENODE,
        this,
        TreeItemCollapsibleState.Collapsed,
      );
    }
    functionsTree.push(functionsNode);
    FuncImpl.ROOT.getChildren = () => functionsTree;
    return functionsTree;
  }

  async getTreeFunction(func: FunctionNode): Promise<FunctionNode[]> {
    const deployedFunction: Map<string, FunctionNode> = await this.getDeployedFunction(func);
    const deployedLocalFunction: FunctionNode[] = await this.getLocalFunction(func, deployedFunction);
    if (deployedLocalFunction.length === 0) {
      return [
        new FunctionNodeImpl(func, 'No Functions Found', FunctionContextType.NONE, this, TreeItemCollapsibleState.None, null),
      ];
    }
    return deployedLocalFunction;
  }

  async getDeployedFunction(func: FunctionNode): Promise<Map<string, FunctionNode>> {
    const functionTreeView = new Map<string, FunctionNode>();
    let result: CliExitData;
    let functionList: FunctionList[];
    try {
      result = await knExecutor.execute(FuncAPI.funcList(), process.cwd(), false);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      functionList = JSON.parse(result.stdout);
    } catch (err) {
      // ignores
    }
    if (functionList && functionList.length !== 0) {
      functionList.forEach((value) => {
        const obj: FunctionNodeImpl = new FunctionNodeImpl(
          func,
          value.name,
          FunctionContextType.DEPLOYFUNCTION,
          this,
          TreeItemCollapsibleState.None,
          null,
          value.runtime,
          FunctionStatus.CLUSTERONLY,
          value.url,
        );
        functionTreeView.set(value.name, obj);
      });
    }
    return functionTreeView;
  }

  async getLocalFunction(func: FunctionNode, functionTreeView: Map<string, FunctionNode>): Promise<FunctionNode[]> {
    const folders: Uri[] = [];
    const functionList: FunctionNode[] = [];
    if (workspace.workspaceFolders && workspace.workspaceFolders.length > 0) {
      // eslint-disable-next-line no-restricted-syntax
      for (const wf of workspace.workspaceFolders) {
        if (fs.existsSync(path.join(wf.uri.fsPath, 'func.yaml'))) {
          folders.push(wf.uri);
        }
      }
    }
    if (folders.length !== 0) {
      // eslint-disable-next-line no-restricted-syntax
      for (const folderUri of folders) {
        let funcStatus = FunctionStatus.LOCALONLY;
        try {
          // eslint-disable-next-line no-await-in-loop
          const funcYaml: string = await fs.readFile(path.join(folderUri.fsPath, 'func.yaml'), 'utf-8');
          // eslint-disable-next-line no-await-in-loop
          const getCurrentNamespace: string = await activeNamespace();
          // eslint-disable-next-line no-await-in-loop
          const functionNamespace = await getFunctionInfo(folderUri);
          const getFunctionNamespace = functionNamespace?.namespace;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          const funcData: FuncContent[] = yaml.safeLoadAll(funcYaml);
          if (getCurrentNamespace === getFunctionNamespace) {
            funcStatus = FunctionStatus.CLUSTERLOCALBOTH;
          }
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          fs.watch(folderUri.fsPath, (eventName, filename) => {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            functionExplorer.refresh();
          });
          const contextValue =
            funcStatus === FunctionStatus.CLUSTERLOCALBOTH
              ? FunctionContextType.LOCALDEPLOYFUNCTION
              : FunctionContextType.LOCAlFUNCTIONS;
          if (funcData && funcData?.[0]?.name && funcData?.[0]?.image.trim()) {
            const url = functionTreeView.get(funcData?.[0]?.name)?.url;
            functionTreeView.set(
              funcData?.[0]?.name,
              new FunctionNodeImpl(
                func,
                funcData[0].name,
                contextValue,
                this,
                TreeItemCollapsibleState.None,
                folderUri,
                funcData[0].runtime,
                funcStatus,
                url,
              ),
            );
          } else if (funcData && funcData?.[0]?.name && !funcData?.[0]?.image.trim()) {
            functionTreeView.set(
              funcData?.[0]?.name,
              new FunctionNodeImpl(
                func,
                funcData[0].name,
                FunctionContextType.LOCAlFUNCTIONSENABLEMENT,
                this,
                TreeItemCollapsibleState.None,
                folderUri,
                funcData[0].runtime,
                funcStatus,
              ),
            );
          }
        } catch (err) {
          // ignore
        }
      }
    }
    if (functionTreeView.size === 0) {
      return functionList;
    }
    functionTreeView.forEach((value) => {
      functionList.push(value);
    });
    return functionList;
  }
}

export const func = new FuncImpl();
