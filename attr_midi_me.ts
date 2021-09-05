/**
 * Extended implementation of MidiME, allowing attribute-based regularisation
 * when trained on a mini-batch of latent vectors generated by `MusicVAE`.
 *
 * Author: Thomas Kaplan
 *
 */

import * as tf from '@tensorflow/tfjs';
import * as logging from '../core/logging';
import {performance} from '../core/compat/global';
import {MidiMe, MidiMeConfig} from './midi_me';
export {AttrMidiMe};

/**
 * An interface for providing configurable properties in the AttrMidiMe model.
 * @param reg_dim Index of the latent dimension to be regularized.
 * @param attr_k Spread of the posterior for calculating attribute loss. The default is 10.
 * @param attr_beta Weight of attribute loss in the total VAE loss. The default is 100.
 */
interface AttrMidiMeConfig extends MidiMeConfig{
  reg_dim?: number;
  attr_k?: number;
  attr_beta?: number;
}

/**
 * `AttrMidiMe` model class.
 *
 * Extension of `MidiMe`, allowing regularization using an attribute-vector in
 * addition to latent vectors generated by `MusicVAE`. It allows even further
 * personalization/constraint of MusicVAE models.
 */
class AttrMidiMe extends MidiMe {

  public config: AttrMidiMeConfig;

  /**
   * `AttrMidiMe` constructor.
   *
   * @param config (optional) Model configuration.
   */
  constructor(config: AttrMidiMeConfig = {}) {
    super(config);
    this.config.reg_dim = config.reg_dim || 0;
    this.config.attr_k = config.attr_k || 10;
    this.config.attr_beta = config.attr_beta || 100;
  }

  /**
   * Trains the `VAE` on the provided data. The number of epochs to train for
   * is taken from the model's configuration.
   * @param data Training `Tensor` of shape `[_, this.config['latent_size']]`.
   * @param data Attribute `Tensor` of shape `[_, 1]`.
   * @param callback A function to be called at the end of every
   * training epoch, containing the training errors for that epoch.
   */
  async trainAttr(xTrain: tf.Tensor, xAttr: tf.Tensor, callback?: Function) {
    const startTime = performance.now();
    this.trained = false;

    // Compute attribute distance matrix using signed differences
    const distAttr2D = this.distanceMatrix(xAttr);
    const distAttr = tf.sign(distAttr2D.reshape([-1])) as tf.Tensor1D;

    // NOTE: This is for consistency with the `MidiMe` implementation.
    // On float16 devices, use a smaller learning rate to avoid NaNs.
    let learningRate = 0.001;  // The default tf.train.adam rate.
    if (tf.ENV.get('WEBGL_RENDER_FLOAT32_ENABLED') === false &&
        tf.ENV.get('WEBGL_DOWNLOAD_FLOAT_ENABLED') === false &&
        tf.ENV.get('WEBGL_VERSION') === 1) {
      // This is a float16 device!
      learningRate = 0.00005;
    }
    const optimizer = tf.train.adam(learningRate);

    for (let e = 0; e < this.config.epochs; e++) {
      await tf.nextFrame();

      await optimizer.minimize(() => {
        return tf.tidy(() => {
          // Standard VAE reconstruction and KL loss
          const [, zMu, zSigma] = this.encoder.predict(xTrain) as tf.Tensor[];
          const y = this.vae.predict(xTrain) as tf.Tensor;
          const loss = this.loss(zMu, zSigma, y, xTrain);

          // Compute distance matrix for regularised dimension of latents
          const distZ = this.regDimension(zMu);
          // Calculate regularisation loss between latents and attributes
          const regLoss = tf.metrics.meanAbsoluteError(distAttr, distZ) as tf.Scalar;
          // Weight the loss term before updating total epoch loss
          const regLossB = tf.mul(this.config.attr_beta, regLoss) as tf.Scalar;
          const totalLoss = tf.add(loss.totalLoss, regLossB) as tf.Scalar;

          if (callback) {
            callback(e, {
              y,
              total: totalLoss.arraySync(),
              losses: [
                regLossB.arraySync(),
                loss.reconLoss.arraySync(),
                loss.latentLoss.arraySync()
              ]
            });
          }
          return totalLoss;
        });
      });

      // Use tf.nextFrame to not block the browser.
      await tf.nextFrame();
    }

    logging.logWithDuration('Training finished', startTime, 'AttrMidiMe');
    this.trained = true;
    optimizer.dispose();
  }

  /**
   * Simple distance matrix implementation for a tf.Tensor1D
   * @param data Attribute `Tensor` of shape `[_, 1]`.
   */
  private distanceMatrix(x: tf.Tensor): tf.Tensor {
    return tf.tidy(() => {
      const x2 = x.reshape([-1, 1]).tile([1, x.shape[0]]) as tf.Tensor2D;
      return tf.sub(x2, x2.transpose());
    });
  }

  /**
   * Converts latent vector into a form expressing monotonicity for the dimension
   * being regularized, range [-1,1].
   * @param data Regularised latent `Tensor` of shape `[_, latent_size]`.
   */
  private regDimension(z: tf.Tensor): tf.Tensor {
    return tf.tidy(() => {
      // Extract dimension being regularised (this.config.reg_dim)
      const zCol = tf.slice(z, [0, this.config.reg_dim], [z.shape[0], 1]);
      const zAttr = zCol.reshape([-1]) as tf.Tensor1D;
      // Calculate monotonicity of distance matrix
      const dist = this.distanceMatrix(zAttr) as tf.Tensor2D;
      const distV = dist.reshape([-1]) as tf.Tensor1D;
      return tf.tanh(tf.mul(this.config.attr_k, distV));
    });
  }
}