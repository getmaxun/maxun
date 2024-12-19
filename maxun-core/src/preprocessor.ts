import Joi from 'joi';
import {
  Workflow, WorkflowFile, ParamType, SelectorArray, Where,
} from './types/workflow';
import { operators } from './types/logic';

/**
* Class for static processing the workflow files/objects.
*/
export default class Preprocessor {
  static validateWorkflow(workflow: WorkflowFile): any {
    const regex = Joi.object({
      $regex: Joi.string().required(),
    });

    const whereSchema = Joi.object({
      url: [Joi.string().uri(), regex],
      selectors: Joi.array().items(Joi.string()),
      cookies: Joi.object({}).pattern(Joi.string(), Joi.string()),
      $after: [Joi.string(), regex],
      $before: [Joi.string(), regex],
      $and: Joi.array().items(Joi.link('#whereSchema')),
      $or: Joi.array().items(Joi.link('#whereSchema')),
      $not: Joi.link('#whereSchema'),
    }).id('whereSchema');

    const schema = Joi.object({
      meta: Joi.object({
        name: Joi.string(),
        desc: Joi.string(),
      }),
      workflow: Joi.array().items(
        Joi.object({
          id: Joi.string(),
          where: whereSchema.required(),
          what: Joi.array().items({
            action: Joi.string().required(),
            args: Joi.array().items(Joi.any()),
          }).required(),
        }),
      ).required(),
    });

    const { error } = schema.validate(workflow);

    return error;
  }

  /**
  * Extracts parameter names from the workflow.
  * @param {WorkflowFile} workflow The given workflow
  * @returns {String[]} List of parameters' names.
  */
  static getParams(workflow: WorkflowFile): string[] {
    const getParamsRecurse = (object: any): string[] => {
      if (typeof object === 'object') {
        // Recursion base case
        if (object.$param) {
          return [object.$param];
        }

        // Recursion general case
        return (Object.values(object) as any[])
          .reduce((p: string[], v: any): string[] => [...p, ...getParamsRecurse(v)], []);
      }
      return [];
    };

    return getParamsRecurse(workflow.workflow);
  }

  /**
  * List all the selectors used in the given workflow (only literal "selector"
  * field in WHERE clauses so far)
  */
  // TODO : add recursive selector search (also in click/fill etc. events?)
  static extractSelectors(workflow: Workflow): SelectorArray {
    /**
* Given a Where condition, this function extracts
* all the existing selectors from it (recursively).
*/
    const selectorsFromCondition = (where: Where): SelectorArray => {
      // the `selectors` field is either on the top level
      let out = where.selectors ?? [];
      if (!Array.isArray(out)) {
        out = [out];
      }

      // or nested in the "operator" array
      operators.forEach((op) => {
        let condWhere = where[op];
        if (condWhere) {
          condWhere = Array.isArray(condWhere) ? condWhere : [condWhere];
          (condWhere).forEach((subWhere) => {
            out = [...out, ...selectorsFromCondition(subWhere)];
          });
        }
      });

      return out;
    };

    // Iterate through all the steps and extract the selectors from all of them.
    return workflow.reduce((p: SelectorArray, step) => [
      ...p,
      ...selectorsFromCondition(step.where).filter((x) => !p.includes(x)),
    ], []);
  }

  /**
  * Recursively crawl `object` and initializes params - replaces the `{$param : paramName}` objects
  * with the defined value.
  * @returns {Workflow} Copy of the given workflow, modified (the initial workflow is left untouched).
  */
  static initWorkflow(workflow: Workflow, params?: ParamType): Workflow {
    const paramNames = this.getParams({ workflow });

    if (Object.keys(params ?? {}).sort().join(',') !== paramNames.sort().join(',')) {
      throw new Error(`Provided parameters do not match the workflow parameters
      provided: ${Object.keys(params ?? {}).sort().join(',')},
      expected: ${paramNames.sort().join(',')}
      `);
    }
    /**
     * A recursive method for initializing special `{key: value}` syntax objects in the workflow.
     * @param object Workflow to initialize (or a part of it).
     * @param k key to look for ($regex, $param)
     * @param f function mutating the special `{}` syntax into
     *            its true representation (RegExp...)
     * @returns Updated object
     */
    const initSpecialRecurse = (
      object: unknown,
      k: string,
      f: (value: string) => unknown,
    ): unknown => {
      if (!object || typeof object !== 'object') {
        return object;
      }

      const out = object;
      // for every key (child) of the object
      Object.keys(object!).forEach((key) => {
        // if the field has only one key, which is `k`
        if (Object.keys((<any>object)[key]).length === 1 && (<any>object)[key][k]) {
          // process the current special tag (init param, hydrate regex...)
          (<any>out)[key] = f((<any>object)[key][k]);
        } else {
          initSpecialRecurse((<any>object)[key], k, f);
        }
      });
      return out;
    };

    // TODO: do better deep copy, this is hideous.
    let workflowCopy = JSON.parse(JSON.stringify(workflow));

    if (params) {
      workflowCopy = initSpecialRecurse(
        workflowCopy,
        '$param',
        (paramName) => {
          if (params && params[paramName]) {
            return params[paramName];
          }
          throw new SyntaxError(`Unspecified parameter found ${paramName}.`);
        },
      );
    }

    // workflowCopy = initSpecialRecurse(
    //   workflowCopy,
    //   '$regex',
    //   (regex) => new RegExp(regex),
    // );

    return <Workflow>workflowCopy;
  }
}