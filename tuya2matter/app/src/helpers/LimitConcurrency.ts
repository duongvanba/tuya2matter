import { Observable, Subject } from 'rxjs';
import { finalize, mergeMap } from 'rxjs/operators';

// Helper type: Only allow methods that return Promise<any>
type AsyncMethod = (...args: any[]) => Promise<any>;

export function LimitConcurrency(limit: number) {
  return function <
    T extends Object,
    K extends keyof T,
    D extends TypedPropertyDescriptor<AsyncMethod>
  >(_target: T, propertyKey: K, descriptor: D): D {
    const fn = descriptor.value!;

    // Runtime check — apply only to async functions (returning Promise)
    const isAsyncFunction = fn.constructor.name === 'AsyncFunction';
    if (!isAsyncFunction) {
      throw new Error(
        `@LimitConcurrency can only be applied to async functions. ` +
        `Method "${String(propertyKey)}" is not async.`
      );
    }

    const queue$ = new Subject<{
      context: any,
      success: Function,
      reject: Function,
      args: any[]
    }>()
    queue$.pipe(
      mergeMap(async ({ args, context, reject, success }) => {
        try {
          const response = await fn.call(context, ...args)
          if (response instanceof Observable) {
            await new Promise<void>(done => {
              success(response.pipe(finalize(done)))
            })
          } else {
            success(response)
          }
        } catch (e) {
          reject(e)
        }
      }, limit)
    ).subscribe() 

    descriptor.value = function (...args: any[]) {
      return new Promise<any>((success, reject) => queue$.next({ reject, success, args, context: this }))
    }


    return descriptor;
  };
}
