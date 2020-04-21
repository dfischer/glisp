;; Graphics and UI
(def $canvas "")
(def $width 1000)
(def $height 1000)
(def $background nil)
(def $guide-color nil)

(def $line-width 1)

;; Sketch
(defn filter-sketch [coll]
  (if (not (vector? coll))
    nil
    (cond
      (keyword? (first coll)) coll
      (vector? (first coll))  (->> coll
                                   (map filter-sketch)
                                   (remove empty?)))))

(defn filter-root-sketch [coll]
  (->> coll
       (map filter-sketch)
       (remove empty?)))

(defn eval-sketch (& xs)
  (vec (filter-root-sketch (slice xs (inc (last-index-of :start-sketch xs)) (count xs)))))


;; Pens and Hands
(defmacro begin-draw [state]
  `(def ~state nil))

(defmacro draw [f state input]
  `(do
     (def __ret__ (~f ~state ~input))
     (def ~state (if (first __ret__) __ret__ (concat (list (first ~state)) (rest __ret__))))
     (first __ret__)))

(def $pens ())
(def $hands ())

(defmacro defpen [name params body]
  `(do
     (def ~name (fn ~params ~body))
     (def $pens (push $pens '~name))))

(defmacro defhand (name params body)
  `(do
     (def ~name (fn ~params ~body))
     (def $hands (push $hands '~name))))
