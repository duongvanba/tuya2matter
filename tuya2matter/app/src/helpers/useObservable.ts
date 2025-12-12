import { Observable } from "rxjs";

export const useObservable = <T>(observable: Observable<T>) => {
    const subscription = observable.subscribe()
    return {
        [Symbol.dispose](){
            subscription.unsubscribe()
        }
    }
}